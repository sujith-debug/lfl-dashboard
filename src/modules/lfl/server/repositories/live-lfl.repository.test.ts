import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FULL_ACCESS, type FeedAccess } from "../ingest/feed-sql";
import type { RawRow } from "../ingest/table-reader";
import { createLiveLflRepository } from "./live-lfl.repository";

/** A stand-in for BigQuery that answers the daily, staff and store feeds and counts how often each runs. */
function fakeBigQuery(access: FeedAccess = FULL_ACCESS) {
  const runs = { daily: 0, stores: 0 };
  const run = async (sql: string): Promise<RawRow[]> => {
    if (sql.includes("TY_Net_sales_after_ERDP")) {
      runs.daily++;
      return [
        {
          D_W_M_Q: "2026-10-01", location_name: "Garuda Mall", Region: "South", AM_CM: "Asha", City: "Bengaluru", First_order_date: "2019-01-01",
          TY_Net_sales_after_ERDP: 1000, LY_Net_sales_after_ERDP: 800, TY_G_sales_after_ERDP: 600, LY_G_sales_after_ERDP: 500,
          TY_S_sales_after_ERDP: 400, LY_S_sales_after_ERDP: 300, TY_NOB: 5, LY_NOB: 4, TY_G_NOB: 2, LY_G_NOB: 1, TY_S_NOB: 4, LY_S_NOB: 3,
          TY_G_qty: 2, LY_G_qty: 1, TY_S_qty: 6, LY_S_qty: 5, TY_G_line_sales: 700, LY_G_line_sales: 560, TY_S_line_sales: 460, LY_S_line_sales: 350,
          TY_FF: 20, LY_FF: 18,
        },
      ];
    }
    if (sql.includes("offline_staff")) {
      return [
        { staff_id: "1", name: "Asha", role: "sm", store_name: "Garuda Mall", started_on: "2025-02-07", left_on: null },
        { staff_id: "2", name: "Ravi", role: "fc", store_name: "Garuda Mall", started_on: "2025-05-01", left_on: "2026-09-30" },
        { staff_id: "3", name: "New", role: "fc", store_name: "Garuda Mall", started_on: "2026-11-01", left_on: null },
      ];
    }
    if (sql.includes("Live Date")) {
      runs.stores++;
      return [{ "Store Name": "Garuda Mall", Region: "South", City: "BENGALURU", AM_CM: "Asha", Type: "Mall", First_order_date: "2019-01-01" }];
    }
    if (sql.includes("Subregion")) return [{ location_id: "1", location_name: "Garuda Mall", Subregion: "S1" }];
    return [];
  };
  return { runs, backend: { run, tables: async () => access, subregions: "SELECT 'Subregion'", maxRunning: 4, defaultTtlMinutes: 60 } };
}

describe("Live BigQuery repository", () => {
  const ranges = { from: "2026-10-01", to: "2026-10-01", lyFrom: "2025-10-01", lyTo: "2025-10-01" };

  it("maps a daily feed row to a TY record and an LY record dated a year back", async () => {
    const repo = createLiveLflRepository(fakeBigQuery().backend);
    const days = await repo.storeDays(ranges);
    assert.equal(days.length, 2);
    const [ty, ly] = days;
    assert.deepEqual([ty!.period, ty!.date, ty!.storeId, ty!.sales, ty!.silverBills, ty!.goldUnits], ["TY", "2026-10-01", "garudamall", 1000, 4, 2]);
    assert.deepEqual([ly!.period, ly!.date, ly!.sales, ly!.silverLineSales], ["LY", "2025-10-01", 800, 350]);
  });

  it("caches each query, so a second load doesn't go back to BigQuery", async () => {
    const fake = fakeBigQuery();
    const repo = createLiveLflRepository(fake.backend);
    // The cache is shared across the process (keyed by SQL), so earlier tests may already have filled it.
    await repo.storeDays({ from: "2026-10-02", to: "2026-10-02", lyFrom: "2025-10-02", lyTo: "2025-10-02" });
    const before = fake.runs.daily;
    await repo.storeDays({ from: "2026-10-02", to: "2026-10-02", lyFrom: "2025-10-02", lyTo: "2025-10-02" });
    assert.equal(fake.runs.daily, before);
  });

  it("reads the store list from the store feed, opening on the first order, with its sub-region", async () => {
    const [store] = await createLiveLflRepository(fakeBigQuery().backend).listStores();
    assert.deepEqual([store!.id, store!.city, store!.type, store!.firstSaleOn, store!.subregion], ["garudamall", "Bengaluru", "Mall", "2019-01-01", "S1"]);
  });

  it("reads staff from the POS staff list: active until handed over, not before they were added", async () => {
    const staff = (await createLiveLflRepository(fakeBigQuery().backend).staff("2026-10-15"))!;
    assert.deepEqual(
      staff.map((s) => [s.name, s.storeId, s.active, s.role]),
      [["Asha", "garudamall", true, "SM"], ["Ravi", "garudamall", false, "FC"], ["New", "garudamall", false, "FC"]]
    );
  });

  it("leaves staff and stock out when the service account can't read their tables", async () => {
    const repo = createLiveLflRepository(fakeBigQuery({ ...FULL_ACCESS, staff: false, staffSales: false, stock: false }).backend);
    assert.equal(await repo.staff("2026-10-15"), null);
    assert.equal(await repo.staffSales!({ from: "2026-10-01", to: "2026-10-15" }), null);
    assert.equal(await repo.inventory({ ty: "2026-10-15", ly: "2025-10-15" }), null);
  });
});
