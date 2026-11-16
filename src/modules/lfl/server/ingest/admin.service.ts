import "server-only";

import { instrumentObject } from "@foundry/logger";
import { prisma } from "@/lib/db/prisma";
import type { AdminStatusDto, BranchLinkDto, DataSource, ImportRunDto } from "../../contracts";
import { normName } from "../services/lfl.service";
import { DATASET_LABELS, DATASETS } from "./datasets";
import type { SyncConfig } from "./sync.service";

type RunRow = Awaited<ReturnType<typeof prisma.lflImportRun.findMany>>[number];

const toDto = (r: RunRow): ImportRunDto => ({
  id: r.id,
  dataset: r.dataset,
  source: r.source,
  label: r.label,
  status: r.status,
  rows: r.rows,
  message: r.message,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Feed freshness, coverage and the carpet sheet, for the admin page. */
export class LflAdminService {
  constructor(
    private readonly source: DataSource,
    private readonly sync: SyncConfig
  ) {}

  async status(): Promise<AdminStatusDto> {
    const [runs, range, dailyStores, stores, profiles, inventory, staffMonths, links] = await Promise.all([
      prisma.lflImportRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
      prisma.lflStoreDay.aggregate({ _min: { date: true }, _max: { date: true } }),
      prisma.lflStoreDay.groupBy({ by: ["storeKey"] }).then((g) => g.length),
      prisma.lflStore.findMany({ orderBy: { name: "asc" } }),
      prisma.storeProfile.findMany(),
      prisma.lflInventory.aggregate({ _max: { snapshotDate: true } }),
      prisma.lflStaffMonth.groupBy({ by: ["month"], orderBy: { month: "desc" } }),
      prisma.lflBranchMap.findMany(),
    ]);
    const latestMonth = staffMonths[0]?.month ?? null;
    const branchRows = latestMonth
      ? await prisma.lflStaffMonth.groupBy({ by: ["branch", "city"], where: { month: latestMonth }, _count: { _all: true } })
      : [];
    const linkOf = new Map(links.map((l) => [l.branch, l]));
    const nameOf = new Map(stores.map((s) => [s.key, s.name]));
    const branchMap = new Map<string, BranchLinkDto>();
    for (const b of branchRows) {
      const link = linkOf.get(b.branch);
      const entry = branchMap.get(b.branch) ?? {
        branch: b.branch,
        city: b.city,
        staff: 0,
        storeKey: link?.storeKey ?? null,
        storeName: link?.storeKey ? (nameOf.get(link.storeKey) ?? link.storeKey) : null,
        method: link?.method ?? "none",
      };
      entry.staff += b._count._all;
      branchMap.set(b.branch, entry);
    }

    const area = new Map(profiles.map((p) => [normName(p.storeName), p.carpetSqft]));
    const storeKeys = new Set(stores.map((s) => s.key));
    const everyMinutes = Number(process.env.LFL_SYNC_INTERVAL_MINUTES) || null;

    return {
      source: this.source,
      feed: {
        configured: this.sync.configured,
        project: this.sync.project,
        location: this.sync.location,
        everyMinutes,
      },
      coverage: {
        dailyFrom: iso(range._min.date),
        dailyTo: iso(range._max.date),
        dailyStores,
        stores: stores.length,
        liveStores: stores.filter((s) => s.status !== "Closed").length,
        storesWithArea: stores.filter((s) => area.has(s.key)).length,
        inventoryAsOf: iso(inventory._max.snapshotDate),
      },
      feeds: DATASETS.map((dataset) => {
        const forDataset = runs.filter((r) => r.dataset === dataset);
        const lastOk = forDataset.find((r) => r.status === "ok");
        return {
          dataset,
          label: DATASET_LABELS[dataset],
          lastOk: lastOk ? toDto(lastOk) : null,
          lastRun: forDataset[0] ? toDto(forDataset[0]) : null,
        };
      }),
      runs: runs.slice(0, 25).map(toDto),
      carpet: stores.map((s) => ({
        storeName: s.name,
        city: s.city,
        type: s.storeType,
        status: s.status,
        sqft: area.get(s.key) ?? null,
      })),
      unmatchedCarpet: storeKeys.size
        ? profiles.filter((p) => !storeKeys.has(normName(p.storeName))).map((p) => p.storeName).sort()
        : [],
      staff: {
        months: staffMonths.map((m) => iso(m.month)!),
        branches: [...branchMap.values()].sort((a, b) => Number(!!a.storeKey) - Number(!!b.storeKey) || a.branch.localeCompare(b.branch)),
        stores: stores.map((s) => ({ key: s.key, name: s.name, city: s.city })),
      },
    };
  }

  /** Branch → store links as CSV, to fix in Excel and upload back as "Staff branch → store links". */
  async branchCsv(): Promise<string> {
    const status = await this.status();
    const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["Branch,Store,City,Staff,Linked by"];
    for (const b of status.staff.branches) {
      lines.push([b.branch, b.storeName ?? "", b.city ?? "", b.staff, b.method].map((v) => quote(String(v))).join(","));
    }
    return `\ufeff${lines.join("\r\n")}\r\n`;
  }

  /** The carpet sheet as CSV, to edit in Excel and upload back. */
  async carpetCsv(): Promise<string> {
    const status = await this.status();
    const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["Store Name,Carpet Area,City,Type,Status"];
    for (const r of status.carpet) {
      lines.push([r.storeName, r.sqft ?? "", r.city ?? "", r.type ?? "", r.status ?? ""].map((v) => quote(String(v))).join(","));
    }
    return `﻿${lines.join("\r\n")}\r\n`;
  }
}

export function createLflAdminService(source: DataSource, sync: SyncConfig): LflAdminService {
  return instrumentObject(new LflAdminService(source, sync), { namePrefix: "lfl.admin", captureResult: false });
}
