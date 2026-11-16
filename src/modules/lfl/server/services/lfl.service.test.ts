import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LflService, ageBucket, isLflExcluded, lflCutoff } from "./lfl.service";
import { alignLy, isCustomLy, shiftYears, weekStart } from "./lfl.dates";
import type { LflRepository, StoreProfileRepository } from "../repositories";
import type {
  InventoryRecord,
  SegmentRecord,
  StaffRecord,
  StoreDayRecord,
  StoreRecord,
} from "../models";

const STORES: StoreRecord[] = [
  { id: "1", name: "Mall One", region: "South", city: "Bengaluru", am: "Asha", firstSaleOn: "2020-01-01", type: "Mall", sqft: null },
  { id: "2", name: "High Street", region: "North", city: "Delhi NCR", am: "Rohit", firstSaleOn: "2021-06-01", type: "HS", sqft: 650 },
  // Opened inside last year's window: not LFL.
  { id: "3", name: "New Store", region: "South", city: "Bengaluru", am: "Asha", firstSaleOn: "2026-02-01", type: null, sqft: 300 },
];

/** withUnits: false is data loaded before the daily feed carried units and line sales. */
const day = (storeId: string, period: "TY" | "LY", date: string, sales: number, gold = 0, withUnits = false): StoreDayRecord => ({
  storeId,
  period,
  date,
  sales,
  gold,
  silver: sales - gold,
  bills: sales / 1000,
  goldBills: gold / 10000,
  footfall: sales / 250,
  silverBills: (sales - gold) / 1000,
  goldUnits: withUnits ? gold / 1000 : 0,
  silverUnits: withUnits ? (sales - gold) / 1000 : 0,
  goldLineSales: withUnits ? gold * 1.2 : 0,
  silverLineSales: withUnits ? (sales - gold) * 1.2 : 0,
  goldMtoSales: withUnits ? gold / 4 : 0,
  goldMtoBills: withUnits ? gold / 40000 : 0,
  goldMtoUnits: withUnits ? gold / 40000 : 0,
  goldMtoLineSales: withUnits ? gold * 0.3 : 0,
});

class FakeRepository implements LflRepository {
  readonly source = "sample" as const;
  constructor(
    private readonly extra: {
      inventory?: InventoryRecord[] | null;
      staff?: StaffRecord[] | null;
      failStaff?: boolean;
      dailyUnits?: boolean;
    } = {}
  ) {}
  async listStores() {
    return STORES;
  }
  async storeDays(): Promise<StoreDayRecord[]> {
    const u = this.extra.dailyUnits ?? false;
    return [
      day("1", "TY", "2026-10-01", 12000, 4000, u),
      day("1", "LY", "2025-10-01", 10000, 2000, u),
      day("2", "TY", "2026-10-02", 9000, 0, u),
      day("2", "LY", "2025-10-02", 10000, 1000, u),
      day("3", "TY", "2026-10-01", 5000, 0, u),
    ];
  }
  async segments(): Promise<SegmentRecord[]> {
    return [
      { storeId: "1", period: "TY", metal: "GOLD", segment: "14KT", category: "R", sales: 3000, units: 2 },
      { storeId: "1", period: "TY", metal: "GOLD", segment: "MYSTERY", category: "R", sales: 1000, units: 1 },
      { storeId: "1", period: "LY", metal: "GOLD", segment: "14KT", category: "R", sales: 2000, units: 2 },
      { storeId: "1", period: "TY", metal: "SILVER", segment: "CLASSIC", category: "ER", sales: 8000, units: 4 },
      { storeId: "1", period: "LY", metal: "SILVER", segment: "CLASSIC", category: "ER", sales: 8000, units: 5 },
      { storeId: "1", period: "TY", metal: "SILVER", segment: "CLASSIC", category: "ZZ", sales: 1, units: 1 },
    ];
  }
  async inventory() {
    return this.extra.inventory ?? null;
  }
  async staff() {
    if (this.extra.failStaff) throw new Error("staff source down");
    return this.extra.staff ?? null;
  }
}

const profiles: StoreProfileRepository = {
  list: async () => [{ storeName: "MALL-ONE", carpetSqft: 420 }],
};

const base = { from: "2026-10-01", to: "2026-10-07" };

describe("LflService", () => {
  it("compares this year to the same dates last year for LFL stores only", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);

    assert.equal(result.meta.lyFrom, "2025-10-01");
    assert.equal(result.meta.lyTo, "2025-10-07");
    assert.equal(result.meta.storeCount, 2);
    assert.deepEqual(result.totals.sales, { ty: 21000, ly: 20000 });
    assert.deepEqual(result.totals.gold, { ty: 4000, ly: 3000 });
    assert.deepEqual(result.totals.stores, { ty: 2, ly: 2 });
  });

  it("includes new stores when LFL-only is off", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard({ ...base, lflOnly: "false" });
    assert.equal(result.meta.storeCount, 3);
    assert.equal(result.totals.sales.ty, 26000);
  });

  it("filters by carpet area using app store profiles, matched by normalised name", async () => {
    const result = await new LflService(new FakeRepository(), profiles).getDashboard({ ...base, sqft: "300-500" });
    assert.deepEqual(result.stores.map((s) => s.id), ["1"]);
    assert.equal(result.stores[0]!.sqft, 420);
  });

  it("filters by region", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard({ ...base, region: "North" });
    assert.deepEqual(result.stores.map((s) => s.id), ["2"]);
  });

  it("keeps every karat row, puts unknown segments in Unmapped and flags them", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.deepEqual(result.gold.map((r) => r.key), ["9KT", "14KT", "18KT", "22KT", "UNMAPPED"]);
    assert.deepEqual(result.gold.find((r) => r.key === "UNMAPPED")!.sales, { ty: 1000, ly: 0 });
    assert.ok(result.meta.notes.some((n) => n.startsWith("Karat isn't mapped for 25%")));
  });

  it("folds tiny categories into Other and names known ones", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.deepEqual(result.categories.all.map((r) => r.label), ["Earrings", "Rings", "Other"]);
    assert.equal(result.categories.gold.length, 1);
  });

  it("aligns last year's days onto this year's weeks in the trend", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.equal(result.trend.points.length, 1);
    // The week starts on a Monday before the range, so the bucket is labelled from the range start.
    assert.ok(weekStart("2026-10-01") < "2026-10-01");
    assert.equal(result.trend.points[0]!.start, "2026-10-01");
    assert.deepEqual(result.trend.points[0]!.sales, { ty: 21000, ly: 20000 });
  });

  it("summarises inventory and staff tenure when connected", async () => {
    const repo = new FakeRepository({
      inventory: [
        { storeId: "1", period: "TY", metal: "SILVER", category: "ER", units: 120 },
        { storeId: "1", period: "LY", metal: "SILVER", category: "ER", units: 100 },
      ],
      staff: [
        { staffId: "a", name: "Asha", storeId: "1", startedOn: "2026-04-07", active: true },
        { staffId: "b", name: "Bala", storeId: "1", startedOn: "2023-10-07", active: true },
        { staffId: "c", name: null, storeId: "2", startedOn: "2026-09-01", active: false },
      ],
    });
    const result = await new LflService(repo, null).getDashboard(base);
    assert.deepEqual(result.inventory.total, { ty: 120, ly: 100 });
    assert.deepEqual(result.categories.silver[0]!.inventory, { ty: 120, ly: 100 });
    assert.equal(result.staff.headcount, 2);
    assert.equal(result.staff.bands.find((b) => b.key === "6-12")!.staff, 1);
    assert.equal(result.staff.bands.find((b) => b.key === "24+")!.staff, 1);
    assert.equal(result.stores.find((s) => s.id === "1")!.staff, 2);
  });

  it("still returns the dashboard when an optional source fails", async () => {
    const result = await new LflService(new FakeRepository({ failStaff: true }), null).getDashboard(base);
    assert.equal(result.staff.connected, false);
    assert.ok(result.meta.notes.some((n) => n.startsWith("Staff tenure could not be loaded")));
  });

  it("rejects ranges of a year or more", async () => {
    await assert.rejects(
      new LflService(new FakeRepository(), null).getDashboard({ from: "2025-10-01", to: "2026-10-01" })
    );
  });
});

describe("LflService.getStoreDetail", () => {
  const staff: StaffRecord[] = [
    { staffId: "a", name: "Asha", storeId: "1", startedOn: "2026-04-07", active: true },
    { staffId: "b", name: "Bala", storeId: "1", startedOn: "2023-10-07", active: false },
    { staffId: "c", name: "Chitra", storeId: "2", startedOn: "2025-01-01", active: true },
  ];

  it("returns one store's numbers, rank and peer groups", async () => {
    const detail = await new LflService(new FakeRepository({ staff }), profiles).getStoreDetail({ ...base, storeId: "1" });
    assert.equal(detail.store.name, "Mall One");
    assert.equal(detail.store.sqft, 420);
    assert.deepEqual(detail.totals.sales, { ty: 12000, ly: 10000 });
    // Store 1 sells more and grows faster than store 2.
    assert.deepEqual(detail.rank, { bySales: 1, byLfl: 1, of: 2 });
    const region = detail.peers.find((p) => p.key === "region")!;
    assert.equal(region.label, "South region");
    assert.equal(region.stores, 1);
    assert.equal(detail.peers.find((p) => p.key === "all")!.stores, 2);
    assert.deepEqual(detail.gold.find((g) => g.key === "14KT")!.sales, { ty: 3000, ly: 2000 });
  });

  it("lists the store's staff, active first", async () => {
    const detail = await new LflService(new FakeRepository({ staff }), null).getStoreDetail({ ...base, storeId: "1" });
    assert.deepEqual(detail.staff.members.map((m) => m.name), ["Asha", "Bala"]);
    assert.ok(Math.abs(detail.staff.members[0]!.tenureMonths - 6) < 0.1);
  });

  it("still opens a store that the filters leave out, without a rank", async () => {
    const detail = await new LflService(new FakeRepository(), null).getStoreDetail({ ...base, storeId: "3" });
    assert.equal(detail.store.isLfl, false);
    assert.equal(detail.rank.bySales, null);
    assert.deepEqual(detail.totals.sales, { ty: 5000, ly: 0 });
  });

  it("404s an unknown store", async () => {
    await assert.rejects(
      new LflService(new FakeRepository(), null).getStoreDetail({ ...base, storeId: "nope" }),
      (error: Error & { status?: number }) => error.status === 404
    );
  });
});

describe("LFL rule (as LFL Metrics Main #8734)", () => {
  it("needs a first order more than 365 days before the period start", () => {
    assert.equal(lflCutoff("2026-09-01"), "2025-09-01");
    assert.equal(lflCutoff("2026-03-01"), "2025-03-01");
  });
  it("leaves out #8734's excluded stores whatever their age", () => {
    assert.equal(isLflExcluded("Garuda Mall"), true);
    assert.equal(isLflExcluded("ELANTE  Chandigarh"), true);
    assert.equal(isLflExcluded("1 MG Mall"), false);
  });
  it("computes conversion from bills on days with footfall only", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    // Every fake day has footfall, so all bills count.
    assert.deepEqual(result.totals.billsWithFootfall, result.totals.bills);
  });
});

describe("lfl dates", () => {
  it("maps 29 Feb to 28 Feb a year earlier", () => {
    assert.equal(shiftYears("2028-02-29", -1), "2027-02-28");
  });
  it("lines a festival's last-year days up with this year's, day for day", () => {
    const sameDates = { from: "2026-10-01", to: "2026-10-31", lyFrom: "2025-10-01", lyTo: "2025-10-31" };
    assert.equal(isCustomLy(sameDates), false);
    assert.equal(alignLy(sameDates)("2025-10-15"), "2026-10-15");
    // Diwali week 2026 (6–11 Nov) against 2025 (18–23 Oct).
    const diwali = { from: "2026-11-06", to: "2026-11-11", lyFrom: "2025-10-18", lyTo: "2025-10-23" };
    assert.equal(isCustomLy(diwali), true);
    assert.equal(alignLy(diwali)("2025-10-18"), "2026-11-06");
    assert.equal(alignLy(diwali)("2025-10-20"), "2026-11-08");
  });
  it("buckets store age by months since first sale", () => {
    assert.equal(ageBucket("2023-01-01", "2026-10-01"), "36 months +");
    assert.equal(ageBucket("2025-12-01", "2026-10-01"), "Under 12 months");
    assert.equal(ageBucket(null, "2026-10-01"), "Unknown");
  });
});

describe("LflService views: cities, store age, AMs, concern stores", () => {
  it("groups stores into metro cities, with NOB and SKU growth", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.deepEqual(result.cities.map((c) => c.key), ["Delhi NCR", "Bengaluru"]);
    const blr = result.cities.find((c) => c.key === "Bengaluru")!;
    assert.equal(blr.stores, 1);
    assert.deepEqual(blr.bills, { ty: 12, ly: 10 });
    assert.deepEqual(blr.units, { ty: 8, ly: 7 });
  });

  it("puts every store, LFL or new, in the store-age view and the Stores list", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.equal(result.ages.reduce((n, a) => n + a.stores, 0), 3);
    assert.deepEqual(result.allStores.map((s) => s.id).sort(), ["1", "2", "3"]);
    assert.equal(result.stores.length, 2);
  });

  it("ranks area managers over LFL stores", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.deepEqual(result.ams.map((a) => [a.key, a.stores]).sort(), [["Asha", 1], ["Rohit", 1]]);
  });

  it("counts degrowing months year to date, whatever the date range", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    assert.equal(result.concerns.from, "2026-01-01");
    assert.equal(result.concerns.months.length, 10);
    assert.deepEqual(result.concerns.rows.map((r) => [r.id, r.degrowingMonths]), [["2", 1]]);
    const fy = await new LflService(new FakeRepository(), null).getDashboard({ ...base, concernBasis: "fytd" });
    assert.equal(fy.concerns.from, "2026-04-01");
  });
});

describe("LflService: gold & silver and per-store numbers", () => {
  it("takes units and ASP line sales from the daily feed when it has them, as #8734", async () => {
    const result = await new LflService(new FakeRepository({ dailyUnits: true }), null).getDashboard(base);
    const gold = result.metals.find((m) => m.key === "gold")!;
    const silver = result.metals.find((m) => m.key === "silver")!;
    // LFL stores 1 and 2 only (store 3 is new).
    assert.deepEqual(gold.units, { ty: 4, ly: 3 });
    assert.deepEqual(silver.units, { ty: 17, ly: 17 });
    assert.deepEqual(gold.lineSales, { ty: 4800, ly: 3600 });
    assert.deepEqual(result.totals.silverBills, { ty: 17, ly: 17 });
  });

  it("falls back to karat / category units for days loaded without them", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    const gold = result.metals.find((m) => m.key === "gold")!;
    const silver = result.metals.find((m) => m.key === "silver")!;
    assert.deepEqual(gold.sales, { ty: 4000, ly: 3000 });
    assert.deepEqual(gold.units, { ty: 3, ly: 2 });
    assert.deepEqual(silver.units, { ty: 5, ly: 5 });
  });

  it("counts trading stores and footfall per group for per-store numbers and conversion", async () => {
    const result = await new LflService(new FakeRepository(), null).getDashboard(base);
    const north = result.regions.find((r) => r.key === "North")!;
    assert.deepEqual(north.trading, { ty: 1, ly: 1 });
    assert.deepEqual(north.goldBills, { ty: 0, ly: 0.1 });
    assert.deepEqual(north.silverBills, { ty: 9, ly: 9 });
    assert.deepEqual(north.footfall, { ty: 36, ly: 40 });
  });
});
