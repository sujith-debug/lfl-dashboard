import "server-only";

import { ValidationError } from "@foundry/api-core";
import { instrumentObject, logger } from "@foundry/logger";
import { prisma } from "@/lib/db/prisma";
import { normName } from "../services/lfl.service";
import {
  CARPET_FIELDS,
  completeSnapshotDays,
  DAILY_FIELDS,
  INVENTORY_FIELDS,
  mapSegment,
  SEGMENT_FIELDS,
  type SegmentRow,
  mapCarpet,
  mapDaily,
  mapInventory,
  mapStore,
  mapStaff,
  mapStaffLink,
  matchBranch,
  registerMonth,
  resolveColumns,
  STAFF_FIELDS,
  STAFF_MAP_FIELDS,
  STAFF_SALES_FIELDS,
  mapStaffSale,
  type StaffRow,
  type StaffSaleRow,
  STORE_FIELDS,
  type Dataset,
  type DailyRow,
  type InventoryRow,
  type StoreRow,
} from "./datasets";
import { readTable, type RawRow } from "./table-reader";

export type ImportResult = {
  runId: string;
  dataset: Dataset;
  rows: number;
  skipped: number;
  notes: string[];
  /** Carpet / stock rows whose store name matched no store in the master list. */
  unmatched: string[];
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** First day of the next month, for YYYY-MM-01. */
const addMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
const CHUNK = 2000;
/** Data rows in a full Excel sheet (1,048,576 minus the header). */
const EXCEL_ROW_LIMIT = 1_048_575;

async function collect<T>(
  rows: AsyncIterable<RawRow>,
  spec: Record<string, { aliases: string[]; required?: boolean }>,
  map: (row: RawRow, columns: Record<string, string | null>) => T | null,
  label: string
) {
  let columns: Record<string, string | null> | null = null;
  const out: T[] = [];
  let skipped = 0;
  for await (const row of rows) {
    if (!columns) {
      const resolved = resolveColumns(Object.keys(row), spec);
      if (resolved.missing.length) {
        throw new ValidationError(
          `This doesn't look like ${label}: missing column${resolved.missing.length > 1 ? "s" : ""} ${resolved.missing.join(", ")}. Found: ${Object.keys(row).slice(0, 12).join(", ")}`
        );
      }
      columns = resolved.columns;
    }
    const mapped = map(row, columns);
    if (mapped) out.push(mapped);
    else skipped++;
  }
  if (!columns) throw new ValidationError("The file has a header but no rows");
  return { rows: out, skipped };
}

/**
 * Loads a feed (BigQuery rows, or a CSV / XLSX upload) into
 * the app database. Re-importing the same days or stores replaces them.
 */
export class LflImportService {
  async importFile(dataset: Dataset, buffer: Buffer, filename: string, source: "upload" | "file"): Promise<ImportResult> {
    const preamble: string[] = [];
    const table = readTable(buffer, filename, (values) => preamble.push(values.filter((v) => v != null).join(" ")));
    return this.importTable(dataset, table, filename, source, preamble);
  }

  /** Rows straight from a BigQuery feed query. */
  async importRows(dataset: Dataset, rows: RawRow[], label: string): Promise<ImportResult> {
    async function* table() {
      yield* rows;
    }
    return this.importTable(dataset, table(), label, "bigquery", []);
  }

  private async importTable(
    dataset: Dataset,
    table: AsyncIterable<RawRow>,
    filename: string,
    source: "bigquery" | "upload" | "file",
    preamble: string[]
  ): Promise<ImportResult> {
    const run = await prisma.lflImportRun.create({
      data: { dataset, source, label: filename.slice(0, 200), status: "running" },
    });
    try {
      const result =
        dataset === "daily"
          ? await this.importDaily(table)
          : dataset === "segments"
            ? await this.importSegments(table)
          : dataset === "stores"
            ? await this.importStores(table)
            : dataset === "inventory"
              ? await this.importInventory(table)
              : dataset === "staff"
                ? await this.importStaff(table, () => registerMonth(...preamble, filename))
                : dataset === "staffmap"
                  ? await this.importStaffMap(table)
                  : dataset === "staffsales"
                    ? await this.importStaffSales(table)
                    : await this.importCarpet(table);
      await prisma.lflImportRun.update({
        where: { id: run.id },
        data: {
          status: "ok",
          rows: result.rows,
          message: [...result.notes, result.unmatched.length ? `${result.unmatched.length} unmatched store names` : ""]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 1000),
          finishedAt: new Date(),
        },
      });
      logger.info({ dataset, source, rows: result.rows, skipped: result.skipped }, "LFL import finished");
      return { runId: run.id, dataset, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.lflImportRun.update({
        where: { id: run.id },
        data: { status: "failed", message: message.slice(0, 1000), finishedAt: new Date() },
      });
      logger.warn({ dataset, source, err: message }, "LFL import failed");
      throw error;
    }
  }

  private async importDaily(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect<DailyRow>(table, DAILY_FIELDS, mapDaily as never, "the LFL daily export");
    if (!rows.length) throw new ValidationError("No day-level rows found. Run the LFL question with the Day grain.");
    // Later rows win if a file repeats a store-day.
    const unique = new Map(rows.map((r) => [`${r.storeKey}|${r.date}`, r]));
    const list = [...unique.values()];
    const dates = list.map((r) => r.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const keys = [...new Set(list.map((r) => r.storeKey))];

    await prisma.$transaction(
      async (tx) => {
        await tx.lflStoreDay.deleteMany({
          where: { date: { gte: day(from), lte: day(to) }, storeKey: { in: keys } },
        });
        for (let i = 0; i < list.length; i += CHUNK) {
          await tx.lflStoreDay.createMany({
            data: list.slice(i, i + CHUNK).map(({ firstOrderDate: _, ...r }) => ({ ...r, date: day(r.date) })),
          });
        }
      },
      { timeout: 120_000 }
    );
    // The daily feed also carries each store's first order date; new stores appear here first.
    const firstOrders = new Map<string, DailyRow>();
    for (const r of list) if (r.firstOrderDate && !firstOrders.has(r.storeKey)) firstOrders.set(r.storeKey, r);
    for (const r of firstOrders.values()) {
      await prisma.lflStore.upsert({
        where: { key: r.storeKey },
        create: { key: r.storeKey, name: r.storeName, region: r.region, city: r.city, am: r.am, firstOrderDate: day(r.firstOrderDate!) },
        update: { firstOrderDate: day(r.firstOrderDate!) },
      });
    }
    return {
      rows: list.length,
      skipped,
      notes: [`${from} to ${to}`, `${keys.length} stores`, skipped ? `${skipped} non-day rows skipped` : ""].filter(Boolean),
      unmatched: [],
    };
  }

  private async importSegments(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect<SegmentRow>(table, SEGMENT_FIELDS, mapSegment as never, "the karat / category export");
    if (!rows.length) throw new ValidationError("No rows in the karat / category export");
    // Sum duplicates (e.g. two category spellings that tidy to the same key).
    const merged = new Map<string, SegmentRow>();
    for (const r of rows) {
      const k = `${r.storeKey}|${r.date}|${r.metal}|${r.segment}|${r.category}`;
      const m = merged.get(k);
      if (m) {
        m.tySales += r.tySales;
        m.lySales += r.lySales;
        m.tyUnits += r.tyUnits;
        m.lyUnits += r.lyUnits;
      } else merged.set(k, { ...r });
    }
    const list = [...merged.values()];
    const dates = list.map((r) => r.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    await prisma.$transaction(
      async (tx) => {
        // The query covers every store for these days, so replace the whole range.
        await tx.lflSegmentDay.deleteMany({ where: { date: { gte: day(from), lte: day(to) } } });
        for (let i = 0; i < list.length; i += CHUNK) {
          await tx.lflSegmentDay.createMany({ data: list.slice(i, i + CHUNK).map((r) => ({ ...r, date: day(r.date) })) });
        }
      },
      { timeout: 120_000 }
    );
    return { rows: list.length, skipped, notes: [`${from} to ${to}`], unmatched: [] };
  }

  private async importStores(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect<StoreRow>(table, STORE_FIELDS, mapStore as never, "a store details sheet");
    const unique = [...new Map(rows.map((r) => [r.key, r])).values()];
    await prisma.$transaction(
      unique.map((r) => {
        const data = {
          name: r.name,
          code: r.code,
          locationId: r.locationId,
          region: r.region,
          subregion: r.subregion,
          city: r.city,
          state: r.state,
          am: r.am,
          // A feed with no type for a store keeps the type another source gave it.
          ...(r.storeType ? { storeType: r.storeType } : {}),
          status: r.status,
          liveDate: r.liveDate ? day(r.liveDate) : null,
          closeDate: r.closeDate ? day(r.closeDate) : null,
          // Sheets without these columns leave what the BigQuery feed set.
          ...(r.firstOrderDate ? { firstOrderDate: day(r.firstOrderDate) } : {}),
          ...(r.lastSaleDate ? { lastSaleDate: day(r.lastSaleDate) } : {}),
          ...(r.ownership ? { ownership: r.ownership } : {}),
          ...(r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : {}),
        };
        return prisma.lflStore.upsert({ where: { key: r.key }, create: { key: r.key, ...data }, update: data });
      })
    );
    const closed = unique.filter((r) => r.status === "Closed" || r.closeDate).length;
    return { rows: unique.length, skipped, notes: [`${closed} closed`], unmatched: [] };
  }

  private async importInventory(table: AsyncIterable<RawRow>) {
    const totals = new Map<string, InventoryRow>();
    const storesByDay = new Map<string, Set<string>>();
    let skipped = 0;
    let rowsRead = 0;
    let columns: Record<string, string | null> | null = null;
    // Summed while streaming: a SKU-level export can be a million rows.
    for await (const raw of table) {
      if (!columns) {
        const resolved = resolveColumns(Object.keys(raw), INVENTORY_FIELDS);
        if (resolved.missing.length) {
          throw new ValidationError(`This doesn't look like a stock export: missing ${resolved.missing.join(", ")}`);
        }
        columns = resolved.columns;
      }
      const row = mapInventory(raw, columns as never);
      if (!row) {
        skipped++;
        continue;
      }
      rowsRead++;
      const k = `${row.date}|${row.storeKey}|${row.metal}|${row.category}`;
      const t = totals.get(k);
      if (t) t.units += row.units;
      else totals.set(k, { ...row });
      const stores = storesByDay.get(row.date) ?? new Set<string>();
      stores.add(row.storeKey);
      storesByDay.set(row.date, stores);
    }
    const keep = completeSnapshotDays(storesByDay);
    // A file that hit Excel's row limit stops part-way through its last day.
    const hitRowLimit = rowsRead + skipped >= EXCEL_ROW_LIMIT - 1;
    if (hitRowLimit) {
      const last = [...keep].sort().pop();
      if (last) keep.delete(last);
    }
    const dropped = [...storesByDay.keys()].filter((d) => !keep.has(d)).sort();
    const list = [...totals.values()].filter((t) => keep.has(t.date));
    if (!list.length) throw new ValidationError("No complete stock day in the file");

    await prisma.$transaction(
      async (tx) => {
        await tx.lflInventory.deleteMany({ where: { snapshotDate: { in: [...storesByDay.keys()].map(day) } } });
        for (let i = 0; i < list.length; i += CHUNK) {
          await tx.lflInventory.createMany({
            data: list.slice(i, i + CHUNK).map((t) => ({ snapshotDate: day(t.date), storeKey: t.storeKey, metal: t.metal, category: t.category, units: t.units })),
          });
        }
      },
      { timeout: 120_000 }
    );
    const known = new Set((await prisma.lflStore.findMany({ select: { key: true } })).map((s) => s.key));
    const unmatched = known.size ? [...new Set(list.map((t) => t.storeKey))].filter((k) => !known.has(k)) : [];
    return {
      rows: list.length,
      skipped,
      notes: [
        `${rowsRead.toLocaleString("en-IN")} SKU rows summed`,
        `days ${[...keep].sort().join(", ")}`,
        dropped.length ? `incomplete day${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")} left out` : "",
        hitRowLimit ? "the file hit Excel's row limit, so its last day was left out; send stock totals per store and category instead" : "",
      ].filter(Boolean),
      unmatched,
    };
  }

  private async importCarpet(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect(table, CARPET_FIELDS, mapCarpet as never, "a carpet area sheet");
    const list = rows as { storeName: string; sqft: number }[];
    await prisma.$transaction(
      list.map((r) =>
        prisma.storeProfile.upsert({
          where: { storeName: r.storeName },
          create: { storeName: r.storeName, carpetSqft: r.sqft },
          update: { carpetSqft: r.sqft },
        })
      )
    );
    const known = new Set((await prisma.lflStore.findMany({ select: { key: true } })).map((s) => s.key));
    const unmatched = known.size ? list.filter((r) => !known.has(normName(r.storeName))).map((r) => r.storeName) : [];
    return { rows: list.length, skipped, notes: [], unmatched };
  }

  /**
   * One month's HR pay register. The month comes from the title row
   * ("Pay Register For The Month Aug 2026") or the file name. Re-importing a
   * month replaces it. New branch names are linked to stores by name; links
   * set by hand are kept.
   */
  private async importStaff(table: AsyncIterable<RawRow>, monthOf: () => string | null) {
    const { rows, skipped } = await collect<StaffRow>(table, STAFF_FIELDS, mapStaff as never, "an HR staff register");
    const month = monthOf();
    if (!month) {
      throw new ValidationError(
        "Couldn't tell which month this register is for. Keep the title row (\"Pay Register For The Month Aug 2026\") or name the file like \"EBO Store Staff - Aug 2026.xlsx\"."
      );
    }
    const unique = [...new Map(rows.map((r) => [r.employeeNo, r])).values()];
    if (!unique.length) throw new ValidationError("No store staff rows in the register");
    await prisma.$transaction(
      async (tx) => {
        await tx.lflStaffMonth.deleteMany({ where: { month: day(month) } });
        for (let i = 0; i < unique.length; i += CHUNK) {
          await tx.lflStaffMonth.createMany({
            data: unique.slice(i, i + CHUNK).map((r) => ({
              month: day(month),
              employeeNo: r.employeeNo,
              name: r.name,
              designation: r.designation,
              branch: r.branch,
              city: r.city,
              joinDate: day(r.joinDate),
              leaveDate: r.leaveDate ? day(r.leaveDate) : null,
            })),
          });
        }
      },
      { timeout: 120_000 }
    );

    const linked = await this.linkBranches(new Map(unique.map((r) => [r.branch, r.city])));
    const bySales = await this.linkBranchesFromSales();
    const monthEnd = addMonth(month);
    const joined = unique.filter((r) => r.joinDate >= month && r.joinDate < monthEnd).length;
    const left = unique.filter((r) => r.leaveDate && r.leaveDate >= month && r.leaveDate < monthEnd).length;
    return {
      rows: unique.length,
      skipped,
      notes: [
        `${unique.length.toLocaleString("en-IN")} staff for ${month.slice(0, 7)}`,
        `${joined} joined and ${left} left that month`,
        linked.added ? `${linked.added} new branch${linked.added > 1 ? "es" : ""} linked to stores by name` : "",
        bySales ? `${bySales} branch${bySales > 1 ? "es" : ""} linked from where their staff sell` : "",
      ].filter(Boolean),
      unmatched: await this.stillUnlinked(linked.unmatched),
    };
  }

  /** Sales per salesperson per store-day. Re-importing a date range replaces it. */
  private async importStaffSales(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect<StaffSaleRow>(table, STAFF_SALES_FIELDS, mapStaffSale as never, "a staff sales export");
    if (!rows.length) throw new ValidationError("No staff sales rows in the file");
    const unique = new Map<string, StaffSaleRow>();
    for (const r of rows) {
      const k = `${r.date}|${r.storeKey}|${r.staffId}`;
      const prev = unique.get(k);
      // A name change for the same id can split a group; add them back together.
      if (prev) {
        prev.sales += r.sales;
        prev.gold += r.gold;
        prev.bills += r.bills;
        prev.units += r.units;
      } else unique.set(k, { ...r });
    }
    const list = [...unique.values()];
    const dates = list.map((r) => r.date).sort();
    const [from, to] = [dates[0]!, dates[dates.length - 1]!];
    await prisma.$transaction(
      async (tx) => {
        await tx.lflStaffSale.deleteMany({ where: { date: { gte: day(from), lte: day(to) } } });
        for (let i = 0; i < list.length; i += CHUNK) {
          await tx.lflStaffSale.createMany({ data: list.slice(i, i + CHUNK).map((r) => ({ ...r, date: day(r.date) })) });
        }
      },
      { timeout: 300_000 }
    );
    const bySales = await this.linkBranchesFromSales();
    const withStaff = list.filter((r) => r.staffId).reduce((n, r) => n + r.sales, 0);
    const total = list.reduce((n, r) => n + r.sales, 0);
    return {
      rows: list.length,
      skipped,
      notes: [
        `${from} to ${to}`,
        `${total > 0 ? ((withStaff / total) * 100).toFixed(1) : "0"}% of sales have a salesperson`,
        bySales ? `${bySales} staff branch${bySales > 1 ? "es" : ""} linked from where their staff sell` : "",
      ].filter(Boolean),
      unmatched: [],
    };
  }

  /** Branch → store links, e.g. the review sheet from the admin page, filled in. */
  private async importStaffMap(table: AsyncIterable<RawRow>) {
    const { rows, skipped } = await collect(table, STAFF_MAP_FIELDS, mapStaffLink as never, "a branch → store sheet");
    const list = rows as { branch: string; store: string | null }[];
    const stores = await prisma.lflStore.findMany({ select: { key: true, name: true } });
    const byKey = new Set(stores.map((s) => s.key));
    const unmatched: string[] = [];
    const links = list.map((r) => {
      const key = r.store ? normName(r.store) : null;
      if (key && !byKey.has(key)) unmatched.push(r.store!);
      return { branch: r.branch, storeKey: key && byKey.has(key) ? key : null };
    });
    await prisma.$transaction(
      links.map((l) =>
        prisma.lflBranchMap.upsert({
          where: { branch: l.branch },
          create: { branch: l.branch, storeKey: l.storeKey, method: "manual" },
          update: { storeKey: l.storeKey, method: "manual" },
        })
      )
    );
    return { rows: links.length, skipped, notes: [`${links.filter((l) => l.storeKey).length} branches linked`], unmatched };
  }

  /** Links branches that have no link yet (or only a failed automatic one). Returns branches still without a store. */
  private async linkBranches(branches: Map<string, string | null>) {
    const [stores, existing] = await Promise.all([
      prisma.lflStore.findMany({ select: { key: true, name: true, city: true } }),
      prisma.lflBranchMap.findMany(),
    ]);
    const current = new Map(existing.map((e) => [e.branch, e]));
    let added = 0;
    const writes = [];
    for (const [branch, city] of branches) {
      const known = current.get(branch);
      if (known && (known.method === "manual" || known.storeKey)) continue;
      const match = matchBranch(branch, city, stores);
      if (match.storeKey) added++;
      writes.push(
        prisma.lflBranchMap.upsert({
          where: { branch },
          create: { branch, storeKey: match.storeKey, method: match.method },
          update: { storeKey: match.storeKey, method: match.method },
        })
      );
      current.set(branch, { branch, storeKey: match.storeKey, method: match.method, updatedAt: new Date() });
    }
    if (writes.length) await prisma.$transaction(writes);
    const unmatched = [...branches.keys()].filter((b) => !current.get(b)?.storeKey && current.get(b)?.method !== "manual");
    return { added, unmatched };
  }

  /**
   * Links branches from where their people sell: most POS staff ids are the
   * HR employee number, so if at least 2 people from a branch, and 60% of the
   * branch's sellers, bill in one store, that's the branch's store. Overrides
   * unlinked branches, staff-name guesses and similar-name links; never exact
   * or manual links.
   */
  async linkBranchesFromSales(): Promise<number> {
    const votes = await prisma.$queryRaw<{ branch: string; storeKey: string }[]>`
      WITH emp AS (
        SELECT s.branch, s."employeeNo", s.month FROM lfl_staff_months s
        JOIN lfl_branch_map b ON b.branch = s.branch WHERE b.method IN ('none', 'staff', 'name')
      ),
      sold AS (
        SELECT e.branch, x."storeKey", e."employeeNo" FROM emp e
        JOIN lfl_staff_sales x ON upper(x."staffId") = upper(e."employeeNo")
          AND date_trunc('month', x.date) = e.month AND x.bills > 0
        GROUP BY 1, 2, 3
      ),
      counted AS (SELECT branch, "storeKey", COUNT(DISTINCT "employeeNo") AS people FROM sold GROUP BY 1, 2),
      ranked AS (
        SELECT branch, "storeKey", people, SUM(people) OVER (PARTITION BY branch) AS total,
               ROW_NUMBER() OVER (PARTITION BY branch ORDER BY people DESC) AS rn
        FROM counted
      )
      SELECT r.branch, r."storeKey" FROM ranked r JOIN lfl_stores st ON st.key = r."storeKey"
      WHERE r.rn = 1 AND r.people >= 2 AND r.people::float / r.total >= 0.6`;
    if (votes.length) {
      await prisma.$transaction(
        votes.map((v) => prisma.lflBranchMap.update({ where: { branch: v.branch }, data: { storeKey: v.storeKey, method: "sales" } }))
      );
    }
    return votes.length;
  }

  private async stillUnlinked(branches: string[]): Promise<string[]> {
    if (!branches.length) return [];
    const linked = await prisma.lflBranchMap.findMany({ where: { branch: { in: branches }, storeKey: { not: null } }, select: { branch: true } });
    const done = new Set(linked.map((l) => l.branch));
    return branches.filter((b) => !done.has(b));
  }

  /** Links one HR branch to a store (or to none: not a store) from the admin page. */
  async setBranch(branch: string, storeKey: string | null): Promise<void> {
    await prisma.lflBranchMap.upsert({
      where: { branch },
      create: { branch, storeKey, method: "manual" },
      update: { storeKey, method: "manual" },
    });
  }

  /** Sets one store's carpet area from the admin page. */
  async setCarpet(storeName: string, sqft: number | null): Promise<void> {
    if (sqft == null) {
      await prisma.storeProfile.deleteMany({ where: { storeName } });
      return;
    }
    await prisma.storeProfile.upsert({
      where: { storeName },
      create: { storeName, carpetSqft: Math.round(sqft) },
      update: { carpetSqft: Math.round(sqft) },
    });
  }
}

export function createLflImportService(): LflImportService {
  return instrumentObject(new LflImportService(), { namePrefix: "lfl.import", captureResult: false });
}
