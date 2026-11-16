import type { Pair, StoreRowDto } from "../contracts";
import { storeState } from "./dashboard-reports";
import { growth, ratio } from "./math";
import { col, type ReportTable } from "./types";

/**
 * What goes with store revenue: for each factor, the rank correlation
 * (Spearman) between the factor and revenue across stores. Rank correlation,
 * because a couple of very large stores would otherwise decide a plain
 * correlation on their own. Browser-safe: the city view runs it on the stores
 * already in the dashboard response.
 */

export type DriverKey = "sqft" | "staff" | "tenure" | "footfall" | "conversion" | "abv" | "age";

export type Driver = {
  key: DriverKey;
  label: string;
  /** Axis / tooltip format. */
  format: "int" | "dec" | "share" | "inr" | "months";
  /** What a positive link means, in words. */
  more: string;
  value: (s: StoreRowDto, asOf: string) => number | null;
};

const monthsSince = (from: string | null, to: string): number | null => {
  if (!from) return null;
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  const months = (ty - fy) * 12 + (tm - fm) + (td - fd) / 30;
  return months >= 0 ? months : null;
};

export const DRIVERS: Driver[] = [
  { key: "sqft", label: "Carpet area", format: "int", more: "bigger stores", value: (s) => (s.sqft && s.sqft > 0 ? s.sqft : null) },
  { key: "staff", label: "Staff count", format: "int", more: "more staff", value: (s) => (s.staff && s.staff > 0 ? s.staff : null) },
  { key: "tenure", label: "Staff tenure", format: "months", more: "longer-serving staff", value: (s) => s.avgTenureMonths },
  { key: "footfall", label: "Footfall", format: "int", more: "more walk-ins", value: (s) => (s.footfall.ty > 0 ? s.footfall.ty : null) },
  {
    key: "conversion",
    label: "Conversion",
    format: "share",
    more: "higher conversion",
    value: (s) => (s.footfall.ty > 0 ? ratio(s.billsWithFootfall.ty, s.footfall.ty) : null),
  },
  { key: "abv", label: "Avg bill value", format: "inr", more: "bigger bills", value: (s) => ratio(s.sales.ty, s.bills.ty) },
  { key: "age", label: "Store age", format: "months", more: "older stores", value: (s, asOf) => monthsSince(s.openedOn, asOf) },
];

/** Fewer stores than this and a correlation is noise. */
export const MIN_STORES = 6;

/** Average ranks (ties share the mean rank). */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman rank correlation; null below MIN_STORES pairs or with no spread. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < MIN_STORES) return null;
  return pearson(ranks(xs), ranks(ys));
}

export function strength(r: number | null): "none" | "weak" | "moderate" | "strong" | "n/a" {
  if (r == null) return "n/a";
  const a = Math.abs(r);
  return a < 0.2 ? "none" : a < 0.4 ? "weak" : a < 0.6 ? "moderate" : "strong";
}

/** One line a store manager can read: "Moderate: bigger stores sell more". */
export function verdict(driver: Driver, r: number | null): string {
  const s = strength(r);
  if (s === "n/a") return "Not enough stores with this to tell";
  if (s === "none") return `No real link: ${driver.more} don't sell more or less`;
  const word = s[0]!.toUpperCase() + s.slice(1);
  return r! > 0 ? `${word}: ${driver.more} sell more` : `${word}: ${driver.more} sell less`;
}

export type DriverPoint = { id: string; name: string; x: number; y: number; inCity: boolean };

export type DriverResult = {
  key: DriverKey;
  label: string;
  format: Driver["format"];
  /** Stores with both the factor and sales, across the view / in the city. */
  n: number;
  r: number | null;
  cityN: number;
  cityR: number | null;
  verdict: string;
  cityVerdict: string;
  points: DriverPoint[];
};

/** Stores that traded this year: the base for every driver. */
const trading = (stores: StoreRowDto[]) => stores.filter((s) => s.sales.ty > 0);

export function driverAnalysis(stores: StoreRowDto[], cityIds: Set<string>, asOf: string): DriverResult[] {
  const base = trading(stores);
  return DRIVERS.map((d) => {
    const points: DriverPoint[] = [];
    for (const s of base) {
      const x = d.value(s, asOf);
      if (x == null || !Number.isFinite(x)) continue;
      points.push({ id: s.id, name: s.name, x, y: s.sales.ty, inCity: cityIds.has(s.id) });
    }
    const city = points.filter((p) => p.inCity);
    const r = spearman(points.map((p) => p.x), points.map((p) => p.y));
    const cityR = spearman(city.map((p) => p.x), city.map((p) => p.y));
    return {
      key: d.key,
      label: d.label,
      format: d.format,
      n: points.length,
      r,
      cityN: city.length,
      cityR,
      verdict: verdict(d, r),
      cityVerdict: city.length < MIN_STORES ? `Only ${city.length} store${city.length === 1 ? "" : "s"} here with this` : verdict(d, cityR),
      points,
    };
  });
}

/** Median revenue per store for Mall vs High Street, the one factor that's a category. */
export function typeMedians(stores: StoreRowDto[]): { type: string; stores: number; median: number }[] {
  const byType = new Map<string, number[]>();
  for (const s of trading(stores)) byType.set(s.type, [...(byType.get(s.type) ?? []), s.sales.ty]);
  return [...byType.entries()]
    .map(([type, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      return { type, stores: list.length, median };
    })
    .sort((a, b) => b.median - a.median);
}

/** City totals in the KPI tiles' shape, with trading stores as the per-store divisor. */
export function cityTotals(stores: StoreRowDto[]) {
  const sum = (pick: (s: StoreRowDto) => Pair): Pair =>
    stores.reduce((acc, s) => ({ ty: acc.ty + pick(s).ty, ly: acc.ly + pick(s).ly }), { ty: 0, ly: 0 });
  return {
    sales: sum((s) => s.sales),
    gold: sum((s) => s.gold),
    silver: sum((s) => s.silver),
    bills: sum((s) => s.bills),
    goldBills: sum((s) => s.goldBills),
    silverBills: sum((s) => s.silverBills),
    footfall: sum((s) => s.footfall),
    billsWithFootfall: sum((s) => s.billsWithFootfall),
    stores: { ty: stores.filter((s) => s.sales.ty > 0).length, ly: stores.filter((s) => s.sales.ly > 0).length },
  };
}

/** Every store in the city with the numbers that go with revenue, including revenue per sq ft and per person. */
export function cityStoresTable(city: string, stores: StoreRowDto[]): ReportTable<StoreRowDto> {
  const conv = (s: StoreRowDto) => (s.footfall.ty > 0 ? ratio(s.billsWithFootfall.ty, s.footfall.ty) : null);
  return {
    key: "city-stores",
    title: `Stores in ${city}`,
    description: "Staff and tenure come from GIVA's POS staff list; tenure counts from when a person was added to the POS (records start Feb 2025).",
    rows: [...stores].sort((a, b) => b.sales.ty - a.sales.ty),
    rowKey: (s) => s.id,
    columns: [
      col<StoreRowDto>({ key: "store", label: "Store", type: "text", value: (s) => s.name, sub: (s) => `${s.city} · ${s.type}${s.isLfl ? "" : " · non-LFL"}${storeState(s)}` }),
      col<StoreRowDto>({ key: "sales", label: "Sales TY", type: "inr", value: (s) => s.sales.ty }),
      col<StoreRowDto>({ key: "lfl", label: "LFL", type: "growth", value: (s) => growth(s.sales) }),
      col<StoreRowDto>({ key: "sqft", label: "Sq ft", type: "int", value: (s) => s.sqft }),
      col<StoreRowDto>({ key: "perSqft", label: "Sales / sq ft", type: "inr", value: (s) => (s.sqft ? ratio(s.sales.ty, s.sqft) : null) }),
      col<StoreRowDto>({ key: "staff", label: "Staff", type: "int", value: (s) => s.staff }),
      col<StoreRowDto>({ key: "tenure", label: "Avg tenure", type: "months", value: (s) => s.avgTenureMonths }),
      col<StoreRowDto>({ key: "perStaff", label: "Sales / staff", type: "inr", value: (s) => (s.staff ? ratio(s.sales.ty, s.staff) : null) }),
      col<StoreRowDto>({ key: "footfall", label: "Footfall", type: "int", value: (s) => s.footfall.ty }),
      col<StoreRowDto>({ key: "conv", label: "Conversion", type: "share", value: conv }),
      col<StoreRowDto>({ key: "abv", label: "Avg bill", type: "inr", value: (s) => ratio(s.sales.ty, s.bills.ty) }),
      col<StoreRowDto>({ key: "nob", label: "NOB", type: "int", value: (s) => s.bills.ty }),
      col<StoreRowDto>({ key: "gnob", label: "Gold NOB", type: "int", value: (s) => s.goldBills.ty }),
      col<StoreRowDto>({ key: "snob", label: "Silver NOB", type: "int", value: (s) => s.silverBills.ty }),
    ],
  };
}
