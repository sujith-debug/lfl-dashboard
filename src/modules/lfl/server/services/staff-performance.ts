import { TENURE_BANDS, type TenureSalesDto } from "../../contracts";
import type { StaffRegisterRecord, StaffSaleMonthRecord } from "../models";

/**
 * Staff sales against tenure. Pure functions so they can be tested without
 * a database: the service passes in monthly sales per salesperson (POS) and
 * the HR registers.
 */

export const normKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Who on the register made these sales: the same id (POS ids are often the HR number), else a unique name in the same store. */
export function staffLinker<P extends { employeeNo: string; name: string | null; storeId: string | null }>(people: P[]) {
  const byId = new Map(people.map((p) => [normKey(p.employeeNo), p]));
  const byNameStore = new Map<string, P[]>();
  for (const p of people) {
    const key = `${normKey(p.name)}|${p.storeId ?? ""}`;
    byNameStore.set(key, [...(byNameStore.get(key) ?? []), p]);
  }
  return (sale: { staffId: string; name: string | null; storeId: string }): P | null => {
    const byIdHit = sale.staffId ? byId.get(normKey(sale.staffId)) : undefined;
    if (byIdHit) return byIdHit;
    const candidates = sale.name ? byNameStore.get(`${normKey(sale.name)}|${sale.storeId}`) : undefined;
    return candidates?.length === 1 ? candidates[0]! : null;
  };
}

export const monthsBetweenIso = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) - (Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? 1 : 0);

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Spearman rank correlation (ties get their average rank). */
export function rankCorrelation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const ranks = (a: number[]) => {
    const order = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && order[j + 1]![0] === order[i]![0]) j++;
      for (let k = i; k <= j; k++) r[order[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(x);
  const ry = ranks(y);
  const mean = (n - 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i]! - mean) * (ry[i]! - mean);
    vx += (rx[i]! - mean) ** 2;
    vy += (ry[i]! - mean) ** 2;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/**
 * Fashion consultants' monthly sales by tenure, over the full months up to
 * `asOf` in the given stores. Only people on that month's register for the
 * whole month count, so a joining or leaving month doesn't drag the numbers.
 */
export function tenureVsSales(
  sales: StaffSaleMonthRecord[],
  registers: StaffRegisterRecord[],
  storeIds: Set<string>,
  asOf: string,
  isSalesRole: (role: string | null) => boolean = (role) => /consultant/i.test(role ?? "")
): TenureSalesDto | null {
  const lastFull = nextMonth(asOf.slice(0, 7) + "-01") <= addDayIso(asOf) ? asOf.slice(0, 7) + "-01" : prevMonth(asOf.slice(0, 7) + "-01");
  const byMonth = new Map<string, StaffRegisterRecord[]>();
  for (const r of registers) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
  const linkers = new Map([...byMonth].map(([m, people]) => [m, staffLinker(people)]));

  type Point = { tenure: number; sales: number; bills: number; store: string; month: string };
  const points: Point[] = [];
  for (const s of sales) {
    if (s.month > lastFull || !storeIds.has(s.storeId)) continue;
    const person = linkers.get(s.month)?.({ staffId: s.staffId, name: s.name, storeId: s.storeId });
    if (!person || !isSalesRole(person.role)) continue;
    const end = nextMonth(s.month);
    if (person.joinedOn > s.month || (person.leftOn && person.leftOn < end)) continue;
    points.push({ tenure: monthsBetweenIso(person.joinedOn, s.month), sales: s.sales, bills: s.bills, store: s.storeId, month: s.month });
  }
  if (points.length < 20) return null;

  const bands = TENURE_BANDS.map((b) => {
    const v = points.filter((p) => p.tenure >= b.min && p.tenure < b.max);
    return { key: b.key, label: b.label, staffMonths: v.length, medianSales: median(v.map((p) => p.sales)), medianBills: median(v.map((p) => p.bills)) };
  });
  const byTenureMonth = Array.from({ length: 13 }, (_, m) => {
    const v = points.filter((p) => (m === 12 ? p.tenure >= 12 : p.tenure === m));
    return { month: m, label: m === 12 ? "12+" : String(m + 1), staffMonths: v.length, medianSales: median(v.map((p) => p.sales)) };
  });

  // Same store, same month: does the longer-serving consultant sell more?
  const groups = new Map<string, Point[]>();
  for (const p of points) groups.set(`${p.month}|${p.store}`, [...(groups.get(`${p.month}|${p.store}`) ?? []), p]);
  let pairs = 0;
  let longerWins = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const [a, b] = [g[i]!, g[j]!];
        if (a.tenure === b.tenure || a.sales === b.sales) continue;
        pairs++;
        if (a.tenure > b.tenure === a.sales > b.sales) longerWins++;
      }
    }
  }

  return {
    role: "Fashion consultants",
    months: [...new Set(points.map((p) => p.month))].sort(),
    staffMonths: points.length,
    bands,
    byTenureMonth,
    correlation: rankCorrelation(points.map((p) => p.tenure), points.map((p) => p.sales)),
    pairs,
    longerWinsShare: pairs ? longerWins / pairs : null,
  };
}

function addDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}
