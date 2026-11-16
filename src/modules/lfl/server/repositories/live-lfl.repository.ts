import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { instrumentObject, logger } from "@foundry/logger";
import {
  completeSnapshotDays,
  DAILY_FIELDS,
  INVENTORY_FIELDS,
  mapDaily,
  mapInventory,
  mapSegment,
  mapStaffSale,
  mapStore,
  resolveColumns,
  SEGMENT_FIELDS,
  STAFF_SALES_FIELDS,
  STORE_FIELDS,
  type InventoryRow,
} from "../ingest/datasets";
import { bigQueryFeedAccess, fetchFeed as fetchBigQuery } from "../ingest/bigquery-feed";
import {
  lflDailySql,
  lflInventorySql,
  lflSegmentsSql,
  lflStaffSalesSql,
  lflStaffSql,
  lflStoresSql,
  type FeedAccess,
} from "../ingest/feed-sql";
import { SUBREGION_SQL } from "../ingest/subregion-sql";
import type { RawRow } from "../ingest/table-reader";
import type { InventoryRecord, PeriodRanges, SegmentRecord, StaffRecord, StaffSaleRecord, StoreDayRecord, StoreRecord } from "../models";
import { normName } from "../services/lfl.service";
import { addDays, isCustomLy, latestCompleteDay, shiftYears } from "../services/lfl.dates";
import type { LflRepository } from "./lfl.repository";
import { tidyCity } from "./postgres-lfl.repository";

/**
 * Reads the board live from BigQuery (LFL_DATA_SOURCE=bigquery-live), with no
 * app database in between: the same feed SQL the sync runs, sent on demand
 * with the app's service account and mapped in memory. The SQL reads the
 * tables that account can see: the exact EBO table when it may, else EBO lines
 * rebuilt from Shopify orders (see shopify-lines.ts); staff and stock are left
 * out until their tables are readable. Results are cached for
 * LFL_LIVE_CACHE_MINUTES (default 360: each query is billed), so only the
 * first load of a date range waits.
 *
 * Staff come from the POS staff list (offline_staff) rather than the HR
 * register; carpet areas from LFL_CARPET_FILE (see the container).
 */

/** A stock count older than this before the as-of date is treated as missing (as the Postgres repository). */
const MAX_SNAPSHOT_AGE_DAYS = 3;
const MAX_CACHED_QUERIES = 400;
const CACHE_KEY = Symbol.for("lfl.live.cache");
const SLOTS_KEY = Symbol.for("lfl.live.slots");
/** Background warm-up uses one query slot at a time; viewers' queries go first. */
const MAX_BACKGROUND = 1;
/** Windows that ended before this many days ago don't change: cached for a day. */
const SETTLED_AFTER_DAYS = 7;
const SETTLED_TTL_MS = 24 * 3_600_000;
/** GIVA's stock snapshots start here; earlier days aren't queried. */
const FIRST_STOCK_DAY = "2026-04-24";

type Slots = { running: number; background: number; viewers: (() => void)[]; warmers: (() => void)[] };

/** Where the live board's SQL runs: BigQuery in the app, a fake in tests. */
export type LiveBackend = {
  run(sql: string, label: string): Promise<RawRow[]>;
  tables(): Promise<FeedAccess>;
  /** SQL giving location_id, location_name, Subregion. */
  subregions: string;
  /** Queries let run at once. */
  maxRunning: number;
  defaultTtlMinutes: number;
};

/**
 * BigQuery with the app's service account, reading the best tables it can:
 * checked with free dry runs (re-checked every 30 minutes), so granting access
 * to intermediary.ebo_all_data switches the board to the exact EBO numbers on
 * its own. Each query is billed by data scanned (well under 1 GB on the EBO
 * table; 7-10 GB for a window and its last-year window rebuilt from Shopify
 * orders), hence the long default cache.
 */
function bigQueryBackend(): LiveBackend {
  return {
    run: fetchBigQuery,
    tables: bigQueryFeedAccess,
    subregions: SUBREGION_SQL,
    maxRunning: 8,
    defaultTtlMinutes: 360,
  };
}

const background = new AsyncLocalStorage<true>();

/** Runs `work` (e.g. warming the cache) with its queries behind viewers' ones. */
export function inBackground<T>(work: () => Promise<T>): Promise<T> {
  return background.run(true, work);
}

type Mapper<T> = (row: RawRow, columns: Record<string, string | null>) => T | null;

/** Rows through the importer's column matching and mapping; feed SQL always has the columns, so a miss is a bug. */
function mapRows<T>(rows: RawRow[], spec: Record<string, { aliases: string[]; required?: boolean }>, map: Mapper<T>, label: string): T[] {
  if (!rows.length) return [];
  const { columns, missing } = resolveColumns(Object.keys(rows[0]!), spec);
  if (missing.length) throw new Error(`${label}: query result is missing ${missing.join(", ")}`);
  const out: T[] = [];
  for (const row of rows) {
    const mapped = map(row, columns);
    if (mapped) out.push(mapped);
  }
  return out;
}

class LiveLflRepository implements LflRepository {
  readonly source = "bigquery-live" as const;
  private readonly ttlMs: number;
  /**
   * On globalThis: Next bundles instrumentation (which warms the cache) apart
   * from the pages, so a module-level map would give each its own copy.
   */
  private readonly cache: Map<string, { at: number; rows: Promise<RawRow[]>; refreshing?: boolean }> =
    ((globalThis as Record<symbol, unknown>)[CACHE_KEY] as never) ??
    ((globalThis as Record<symbol, unknown>)[CACHE_KEY] = new Map());
  private readonly slots: Slots =
    ((globalThis as Record<symbol, unknown>)[SLOTS_KEY] as never) ??
    ((globalThis as Record<symbol, unknown>)[SLOTS_KEY] = { running: 0, background: 0, viewers: [], warmers: [] });

  constructor(private readonly backend: LiveBackend) {
    this.ttlMs = (Number(process.env.LFL_LIVE_CACHE_MINUTES) || backend.defaultTtlMinutes) * 60_000;
  }

  /** Waits for a free query slot; viewers are let in before background work. */
  private async slot(isBackground: boolean): Promise<() => void> {
    const s = this.slots;
    const free = () => s.running < this.backend.maxRunning && (!isBackground || (s.background < MAX_BACKGROUND && s.viewers.length === 0));
    while (!free()) await new Promise<void>((resolve) => (isBackground ? s.warmers : s.viewers).push(resolve));
    s.running++;
    if (isBackground) s.background++;
    return () => {
      s.running--;
      if (isBackground) s.background--;
      // Wake everyone waiting; each re-checks whether it may go.
      for (const wake of [...s.viewers.splice(0), ...s.warmers.splice(0)]) wake();
    };
  }

  private async run(sql: string, label: string): Promise<RawRow[]> {
    const isBackground = background.getStore() === true;
    const release = await this.slot(isBackground);
    const started = Date.now();
    try {
      const result = await this.backend.run(sql, label);
      logger.info({ label, rows: result.length, ms: Date.now() - started, background: isBackground }, "LFL live query");
      return result;
    } finally {
      release();
    }
  }

  /**
   * One run per distinct query, shared by concurrent requests. After
   * the TTL the cached rows are still served while a refresh runs in the
   * background, so only a never-seen range waits on BigQuery. Failures aren't cached.
   */
  private query(sql: string, label: string, until?: string): Promise<RawRow[]> {
    const settled = until != null && until < addDays(latestCompleteDay(), -SETTLED_AFTER_DAYS);
    const ttl = settled ? SETTLED_TTL_MS : this.ttlMs;
    const hit = this.cache.get(sql);
    if (hit) {
      if (Date.now() - hit.at >= ttl && !hit.refreshing) {
        hit.refreshing = true;
        this.run(sql, label).then(
          (rows) => this.cache.set(sql, { at: Date.now(), rows: Promise.resolve(rows) }),
          (error: unknown) => {
            hit.refreshing = false;
            logger.warn({ label, err: error instanceof Error ? error.message : String(error) }, "LFL live refresh failed; serving the cached rows");
          }
        );
      }
      return hit.rows;
    }
    // Keep memory bounded: drop the oldest query once there are many date ranges.
    if (this.cache.size >= MAX_CACHED_QUERIES) this.cache.delete(this.cache.keys().next().value!);
    const rows = this.run(sql, label);
    this.cache.set(sql, { at: Date.now(), rows });
    rows.catch(() => this.cache.delete(sql));
    return rows;
  }

  async listStores(): Promise<StoreRecord[]> {
    const tables = await this.backend.tables();
    const [raw, split] = await Promise.all([
      this.query(lflStoresSql(tables), "stores"),
      // Sub-regions are optional: without them the board still loads.
      this.query(this.backend.subregions, "sub-regions").catch((error: unknown) => {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Sub-regions could not be loaded");
        return [] as RawRow[];
      }),
    ]);
    const rows = mapRows(raw, STORE_FIELDS, mapStore as Mapper<ReturnType<typeof mapStore>>, "stores");
    const subById = new Map<string, string>();
    const subByName = new Map<string, string>();
    for (const r of split) {
      const sub = typeof r.Subregion === "string" ? r.Subregion.trim() : null;
      if (!sub) continue;
      if (r.location_id != null) subById.set(String(r.location_id), sub);
      if (typeof r.location_name === "string") subByName.set(normName(r.location_name), sub);
    }
    const byKey = new Map(rows.filter((r) => r !== null).map((r) => [r!.key, r!]));
    return [...byKey.values()].map((m) => ({
      id: m.key,
      name: m.name,
      region: m.region ?? "Unassigned",
      subregion: (m.locationId ? subById.get(m.locationId) : undefined) ?? subByName.get(m.key) ?? null,
      status: m.status,
      lastSaleOn: m.lastSaleDate,
      city: tidyCity(m.city ?? "Unknown"),
      am: m.am ?? "Unassigned",
      // Opening date: first order (as in LFL Metrics Main #8734), else Live Date.
      firstSaleOn: m.firstOrderDate ?? m.liveDate ?? null,
      type: m.storeType ?? null,
      lat: m.latitude ?? null,
      lng: m.longitude ?? null,
      sqft: null,
    }));
  }

  /**
   * TY and LY day records. Normally one query, whose rows carry the same day
   * 365 days earlier; for a custom comparison (a festival), the comparison
   * window is queried on its own and its this-year numbers become LY.
   */
  async storeDays(ranges: PeriodRanges): Promise<StoreDayRecord[]> {
    if (!isCustomLy(ranges)) return this.dailyRecords(ranges.from, ranges.to, "both");
    const [ty, ly] = await Promise.all([
      this.dailyRecords(ranges.from, ranges.to, "TY"),
      this.dailyRecords(ranges.lyFrom, ranges.lyTo, "LY"),
    ]);
    return [...ty, ...ly];
  }

  private async dailyRecords(from: string, to: string, use: "both" | "TY" | "LY"): Promise<StoreDayRecord[]> {
    const raw = await this.query(lflDailySql(from, to, await this.backend.tables()), `daily ${from} to ${to}`, to);
    const rows = mapRows(raw, DAILY_FIELDS, mapDaily as Mapper<ReturnType<typeof mapDaily>>, "daily");
    const out: StoreDayRecord[] = [];
    for (const r of rows) {
      if (!r) continue;
      const ty = {
        storeId: r.storeKey,
        date: r.date,
        sales: r.tySales,
        gold: r.tyGold,
        silver: r.tySilver,
        bills: r.tyBills,
        goldBills: r.tyGoldBills,
        footfall: r.tyFootfall,
        silverBills: r.tySilverBills,
        goldUnits: r.tyGoldUnits,
        silverUnits: r.tySilverUnits,
        goldLineSales: r.tyGoldLineSales,
        silverLineSales: r.tySilverLineSales,
        goldMtoSales: r.tyGoldMtoSales,
        goldMtoBills: r.tyGoldMtoBills,
        goldMtoUnits: r.tyGoldMtoUnits,
        goldMtoLineSales: r.tyGoldMtoLineSales,
      };
      if (use === "LY") {
        out.push({ ...ty, period: "LY" });
        continue;
      }
      out.push({ ...ty, period: "TY" });
      if (use === "TY") continue;
      out.push({
        storeId: r.storeKey,
        period: "LY",
        date: shiftYears(r.date, -1),
        sales: r.lySales,
        gold: r.lyGold,
        silver: r.lySilver,
        bills: r.lyBills,
        goldBills: r.lyGoldBills,
        footfall: r.lyFootfall,
        silverBills: r.lySilverBills,
        goldUnits: r.lyGoldUnits,
        silverUnits: r.lySilverUnits,
        goldLineSales: r.lyGoldLineSales,
        silverLineSales: r.lySilverLineSales,
        goldMtoSales: r.lyGoldMtoSales,
        goldMtoBills: r.lyGoldMtoBills,
        goldMtoUnits: r.lyGoldMtoUnits,
        goldMtoLineSales: r.lyGoldMtoLineSales,
      });
    }
    return out;
  }

  /** Karat / classic / category per store; a custom comparison window is summed on its own, like storeDays. */
  async segments(ranges: PeriodRanges): Promise<SegmentRecord[]> {
    const custom = isCustomLy(ranges);
    const [main, comparison] = await Promise.all([
      this.segmentSums(ranges.from, ranges.to),
      custom ? this.segmentSums(ranges.lyFrom, ranges.lyTo) : Promise.resolve(null),
    ]);
    const out: SegmentRecord[] = [];
    for (const m of main.values()) {
      const base = { storeId: m.storeId, metal: m.metal, segment: m.segment, category: m.category };
      out.push({ ...base, period: "TY", sales: m.ty, units: m.tyU });
      if (!comparison) out.push({ ...base, period: "LY", sales: m.ly, units: m.lyU });
    }
    for (const m of comparison?.values() ?? []) {
      out.push({ storeId: m.storeId, metal: m.metal, segment: m.segment, category: m.category, period: "LY", sales: m.ty, units: m.tyU });
    }
    return out;
  }

  /** Summed per store, metal, segment and category inside BigQuery: a long range is otherwise a million rows. */
  private async segmentSums(from: string, to: string) {
    const sql = `SELECT '${from}' AS date, location_name, metal, segment, category,
  SUM(TY_sales) AS TY_sales, SUM(LY_sales) AS LY_sales, SUM(TY_units) AS TY_units, SUM(LY_units) AS LY_units
FROM (${lflSegmentsSql(from, to, await this.backend.tables())})
GROUP BY 2, 3, 4, 5`;
    const rows = mapRows(await this.query(sql, `segments ${from} to ${to}`, to), SEGMENT_FIELDS, mapSegment as Mapper<ReturnType<typeof mapSegment>>, "segments");
    // Category spellings that tidy to the same key are added together, as the importer does.
    const merged = new Map<string, { storeId: string; metal: "GOLD" | "SILVER"; segment: string; category: string; ty: number; ly: number; tyU: number; lyU: number }>();
    for (const r of rows) {
      if (!r) continue;
      const k = `${r.storeKey}|${r.metal}|${r.segment}|${r.category}`;
      const m = merged.get(k) ?? { storeId: r.storeKey, metal: r.metal, segment: r.segment, category: r.category, ty: 0, ly: 0, tyU: 0, lyU: 0 };
      m.ty += r.tySales;
      m.ly += r.lySales;
      m.tyU += r.tyUnits;
      m.lyU += r.lyUnits;
      merged.set(k, m);
    }
    return merged;
  }

  /** The latest complete stock day within MAX_SNAPSHOT_AGE_DAYS before each as-of date. */
  async inventory(asOf: { ty: string; ly: string }): Promise<InventoryRecord[] | null> {
    const tables = await this.backend.tables();
    if (!tables.stock) return null;
    const window = (date: string) => Array.from({ length: MAX_SNAPSHOT_AGE_DAYS + 1 }, (_, i) => addDays(date, -i));
    const days = [...window(asOf.ty), ...window(asOf.ly)].filter((d) => d >= FIRST_STOCK_DAY);
    if (!days.some((d) => d <= asOf.ty && d >= addDays(asOf.ty, -MAX_SNAPSHOT_AGE_DAYS))) return [];
    const raw = await this.query(lflInventorySql(days, tables), `stock ${asOf.ty} / ${asOf.ly}`, asOf.ty);
    const rows = mapRows(raw, INVENTORY_FIELDS, mapInventory as Mapper<InventoryRow>, "stock");
    const storesByDay = new Map<string, Set<string>>();
    for (const r of rows) storesByDay.set(r.date, (storesByDay.get(r.date) ?? new Set()).add(r.storeKey));
    const complete = completeSnapshotDays(storesByDay);
    const pick = (date: string) => window(date).find((d) => complete.has(d)) ?? null;
    const [ty, ly] = [pick(asOf.ty), pick(asOf.ly)];
    if (!ty) return [];
    const totals = new Map<string, InventoryRecord>();
    for (const r of rows) {
      const period = r.date === ty ? "TY" : r.date === ly ? "LY" : null;
      if (!period) continue;
      const k = `${period}|${r.storeKey}|${r.metal}|${r.category}`;
      const t = totals.get(k);
      if (t) t.units += r.units;
      else totals.set(k, { storeId: r.storeKey, period, snapshotDate: r.date, metal: r.metal, category: r.category, units: r.units });
    }
    return [...totals.values()];
  }

  /**
   * Staff from the POS staff list. Active = added on or before the date and
   * not handed over by then. Tenure counts from when they were added to the
   * POS (from Feb 2025), not the HR joining date.
   */
  async staff(asOf: string): Promise<StaffRecord[] | null> {
    if (!(await this.backend.tables()).staff) return null;
    const rows = await this.query(lflStaffSql(), "staff");
    const out: StaffRecord[] = [];
    for (const r of rows) {
      const store = typeof r.store_name === "string" ? r.store_name : null;
      const startedOn = typeof r.started_on === "string" ? r.started_on.slice(0, 10) : null;
      if (!store || !startedOn) continue;
      const leftOn = typeof r.left_on === "string" ? r.left_on.slice(0, 10) : null;
      out.push({
        staffId: String(r.staff_id),
        name: typeof r.name === "string" ? r.name : null,
        storeId: normName(store),
        startedOn,
        active: startedOn <= asOf && (!leftOn || leftOn > asOf),
        role: typeof r.role === "string" ? r.role.toUpperCase() : null,
        leftOn,
      });
    }
    return out;
  }

  /** Summed per store and salesperson inside BigQuery; days = days with at least one bill. */
  async staffSales(range: { from: string; to: string }): Promise<StaffSaleRecord[] | null> {
    const tables = await this.backend.tables();
    if (!tables.staffSales) return null;
    const sql = `SELECT '${range.from}' AS date, location_name, staff_id, MAX(staff_name) AS staff_name,
  SUM(net_sales) AS net_sales, SUM(gold_sales) AS gold_sales, SUM(bills) AS bills, SUM(units) AS units,
  COUNTIF(bills > 0) AS days
FROM (${lflStaffSalesSql(range.from, range.to, tables)})
GROUP BY 2, 3`;
    const withDays: Mapper<StaffSaleRecord> = (row, c) => {
      const r = mapStaffSale(row, c as never);
      return r
        ? { storeId: r.storeKey, staffId: r.staffId, name: r.staffName, sales: r.sales, gold: r.gold, bills: r.bills, units: r.units, days: Number(row.days) || 0 }
        : null;
    };
    return mapRows(await this.query(sql, `staff sales ${range.from} to ${range.to}`, range.to), STAFF_SALES_FIELDS, withDays, "staff sales");
  }
}

export function createLiveLflRepository(backend: LiveBackend): LflRepository {
  return instrumentObject(new LiveLflRepository(backend), {
    namePrefix: "lfl.repository.bigquery-live",
    captureResult: false,
  });
}

export function createBigQueryLflRepository(): LflRepository {
  return createLiveLflRepository(bigQueryBackend());
}
