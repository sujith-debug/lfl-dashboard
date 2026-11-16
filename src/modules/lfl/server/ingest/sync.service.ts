import "server-only";

import { instrumentObject } from "@foundry/logger";
import { prisma } from "@/lib/db/prisma";
import { addDays } from "../services/lfl.dates";
import { bigQueryFeedAccess, fetchFeed as fetchBigQueryFeed } from "./bigquery-feed";
import type { Dataset } from "./datasets";
import { lflDailySql, lflInventorySql, lflSegmentsSql, lflStaffSalesSql, lflStoresSql, type FeedAccess } from "./feed-sql";
import type { LflImportService } from "./import.service";
import type { RawRow } from "./table-reader";

export type FetchFeed = (sql: string, label: string) => Promise<RawRow[]>;
/** Which tables the feed SQL may read (see FeedAccess). */
export type FeedAccessCheck = () => Promise<FeedAccess>;

export type SyncConfig = {
  /** Credentials are set (BIGQUERY_SERVICE_ACCOUNT_JSON, or a key file / ADC with BIGQUERY_DEFAULT_PROJECT). */
  configured: boolean;
  project: string | null;
  location: string | null;
  /** Days re-pulled on each run, to pick up late corrections. */
  windowDays: number;
};

export function syncConfigFromEnv(env: Record<string, string | undefined> = process.env): SyncConfig {
  const project = env.BIGQUERY_DEFAULT_PROJECT || env.BIGQUERY_PROJECT_ID || null;
  return {
    configured: Boolean(env.BIGQUERY_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS || project),
    project,
    location: env.BIGQUERY_LOCATION || null,
    windowDays: Math.min(366, Math.max(1, Number(env.LFL_SYNC_DAYS) || 7)),
  };
}

export type SyncReport = {
  skipped?: string;
  results: { dataset: Dataset; ok: boolean; rows?: number; message?: string }[];
};

/** Yesterday in India: the latest day with complete sales. */
function yesterdayIst(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

/**
 * Runs the feed queries in BigQuery and loads the results into the app
 * database. Stores first (so new stores and types exist), then sales, karat /
 * category and staff sales a month at a time, then daily stock.
 */
export class LflSyncService {
  constructor(
    private readonly importer: LflImportService,
    private readonly config: SyncConfig,
    private readonly fetchFeed: FetchFeed = fetchBigQueryFeed,
    private readonly access: FeedAccessCheck = bigQueryFeedAccess
  ) {}

  get configured(): boolean {
    return this.config.configured;
  }

  async sync(options: { from?: string; to?: string; datasets?: Dataset[] } = {}): Promise<SyncReport> {
    if (!this.config.configured) {
      return { skipped: "BigQuery isn't configured (BIGQUERY_SERVICE_ACCOUNT_JSON, BIGQUERY_DEFAULT_PROJECT).", results: [] };
    }
    // One sync at a time across app instances: skip if another started in the last 30 minutes.
    const busy = await prisma.lflImportRun.findFirst({
      where: { dataset: "sync", status: "running", startedAt: { gt: new Date(Date.now() - 30 * 60_000) } },
    });
    if (busy) return { skipped: "Another sync is already running.", results: [] };
    const run = await prisma.lflImportRun.create({ data: { dataset: "sync", source: "bigquery", status: "running" } });

    let tables: FeedAccess;
    try {
      tables = await this.access();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.lflImportRun.update({ where: { id: run.id }, data: { status: "failed", message, finishedAt: new Date() } });
      return { results: [{ dataset: "stores", ok: false, message }] };
    }

    const to = options.to ?? yesterdayIst();
    const from = options.from ?? addDays(to, -(this.config.windowDays - 1));
    const wanted = (d: Dataset) => !options.datasets || options.datasets.includes(d);
    const results: SyncReport["results"] = [];

    const pull = async (dataset: Exclude<Dataset, "carpet" | "staff" | "staffmap">, label: string, sql: () => string, readable = true) => {
      if (!wanted(dataset)) return;
      if (!readable) {
        // Not an error: the account hasn't been given that table yet. Older rows stay as they were.
        if (!results.some((r) => r.dataset === dataset)) results.push({ dataset, ok: true, rows: 0, message: "skipped: its BigQuery tables aren't readable yet" });
        return;
      }
      try {
        const rows = await this.fetchFeed(sql(), label);
        const result = await this.importer.importRows(dataset, rows, label);
        results.push({ dataset, ok: true, rows: result.rows, message: result.notes.join(" · ") });
      } catch (error) {
        results.push({ dataset, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    };

    await pull("stores", "stores", () => lflStoresSql(tables));
    // Long backfills go a month at a time to keep each query small.
    for (let start = from; start <= to; ) {
      const monthEnd = addDays(`${start.slice(0, 7)}-01`, 40).slice(0, 7) + "-01";
      const end = addDays(monthEnd, -1) < to ? addDays(monthEnd, -1) : to;
      const [s, e] = [start, end];
      await pull("daily", `daily ${s} to ${e}`, () => lflDailySql(s, e, tables));
      await pull("segments", `segments ${s} to ${e}`, () => lflSegmentsSql(s, e, tables));
      await pull("staffsales", `staff sales ${s} to ${e}`, () => lflStaffSalesSql(s, e, tables), tables.staffSales);
      start = addDays(end, 1);
    }
    // Stock for every day of the window (so any end date has its own count), a month
    // at a time, plus the same day a year earlier for Δ inventory.
    for (let start = from; start <= to; start = addDays(start, 31)) {
      const days: string[] = [];
      for (let d = start; d <= to && d < addDays(start, 31); d = addDays(d, 1)) days.push(d);
      if (start === from) days.push(addDays(to, -365));
      await pull("inventory", `stock from ${days[0]}`, () => lflInventorySql(days, tables), tables.stock);
    }

    const failed = results.filter((r) => !r.ok);
    await prisma.lflImportRun.update({
      where: { id: run.id },
      data: {
        status: failed.length ? "failed" : "ok",
        rows: results.reduce((sum, r) => sum + (r.rows ?? 0), 0),
        message: `${from} to ${to}` + (tables.sales === "shopify" ? " · sales rebuilt from Shopify orders (no ebo_all_data access)" : "") + (failed.length ? ` · ${failed.map((f) => `${f.dataset}: ${f.message}`).join(" | ")}` : ""),
        finishedAt: new Date(),
      },
    });
    return { results };
  }
}

export function createLflSyncService(importer: LflImportService, config: SyncConfig, fetchFeed: FetchFeed = fetchBigQueryFeed, access: FeedAccessCheck = bigQueryFeedAccess): LflSyncService {
  return instrumentObject(new LflSyncService(importer, config, fetchFeed, access), { namePrefix: "lfl.sync", captureResult: false });
}
