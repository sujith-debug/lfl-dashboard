import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoreRowDto } from "../contracts";
import { cityTotals, driverAnalysis, spearman, strength, typeMedians } from "./drivers";

const pair = (ty: number, ly = ty) => ({ ty, ly });
const store = (id: string, sales: number, extra: Partial<StoreRowDto> = {}): StoreRowDto => ({
  id,
  name: `Store ${id}`,
  city: "Bengaluru",
  cityGroup: "Bengaluru",
  subregion: "S1",
  region: "South",
  am: "Asha",
  age: "36 months +",
  type: "Mall",
  sqft: null,
  openedOn: "2020-01-01",
  status: "Live",
  lastSaleOn: null,
  looksShut: false,
  closedButSelling: false,
  lat: null,
  lng: null,
  isLfl: true,
  sales: pair(sales),
  gold: pair(sales / 2),
  silver: pair(sales / 2),
  bills: pair(sales / 1000),
  goldBills: pair(1),
  silverBills: pair(2),
  footfall: pair(100),
  billsWithFootfall: pair(sales / 1000),
  inventory: null,
  staff: null,
  avgTenureMonths: null,
  goldUnits: pair(1),
  silverUnits: pair(1),
  goldLineSales: pair(1),
  silverLineSales: pair(1),
  goldMtoSales: pair(0),
  goldMtoBills: pair(0),
  goldMtoUnits: pair(0),
  goldMtoLineSales: pair(0),
  ...extra,
});

describe("revenue drivers", () => {
  it("ranks rather than measures, so one huge store doesn't decide the link", () => {
    assert.equal(spearman([1, 2, 3, 4, 5, 6], [10, 20, 30, 40, 50, 9_000]), 1);
    assert.equal(spearman([1, 2, 3, 4, 5, 6], [60, 50, 40, 30, 20, 10]), -1);
    assert.equal(spearman([1, 2, 3], [1, 2, 3]), null, "too few stores");
    assert.equal(strength(0.1), "none");
    assert.equal(strength(-0.45), "moderate");
    assert.equal(strength(0.7), "strong");
  });

  it("finds that bigger stores sell more, across the view and in the city", () => {
    const stores = Array.from({ length: 8 }, (_, i) => store(String(i), (i + 1) * 100_000, { sqft: 200 + i * 50, staff: 3 }));
    const city = new Set(stores.slice(0, 6).map((s) => s.id));
    const sqft = driverAnalysis(stores, city, "2026-10-29").find((d) => d.key === "sqft")!;
    assert.equal(sqft.n, 8);
    assert.equal(sqft.r, 1);
    assert.equal(sqft.cityN, 6);
    assert.match(sqft.verdict, /^Strong: bigger stores sell more/);
    assert.equal(sqft.points.filter((p) => p.inCity).length, 6);
    // Every store has 3 staff: no spread, so no correlation to report.
    const staff = driverAnalysis(stores, city, "2026-10-29").find((d) => d.key === "staff")!;
    assert.equal(staff.r, null);
  });

  it("says when a city has too few stores, and leaves out factors a store doesn't have", () => {
    const stores = [store("a", 1, { sqft: 300 }), store("b", 2), store("c", 0, { sqft: 400 })];
    const sqft = driverAnalysis(stores, new Set(["a", "b"]), "2026-10-29").find((d) => d.key === "sqft")!;
    assert.equal(sqft.n, 1, "no area, or no sales this year, means no dot");
    assert.match(sqft.cityVerdict, /^Only 1 store here/);
  });

  it("adds up a city's stores for the headline tiles", () => {
    const t = cityTotals([store("a", 100), store("b", 300), store("c", 0)]);
    assert.deepEqual(t.sales, { ty: 400, ly: 400 });
    assert.deepEqual(t.stores, { ty: 2, ly: 2 });
    const medians = typeMedians([store("a", 100), store("b", 300, { type: "HS" }), store("c", 200)]);
    assert.deepEqual(medians.map((m) => [m.type, m.median]), [["HS", 300], ["Mall", 150]]);
  });
});
