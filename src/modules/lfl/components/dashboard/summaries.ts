import type { GroupRowDto, LflDashboardDto, Pair, StoreRowDto, TenureSalesDto } from "../../contracts";
import { growth, growthOf, ratio, ratioPair } from "../../reports";
import type { TabKey } from "../tabs";
import { count, inr, pct, ptsText, share } from "../ui/format";

/**
 * Plain-language summaries for each tab, built from the same numbers the
 * tab shows (no AI involved, so they're always consistent with the tables).
 */

const lflText = (p: Pair) => {
  const g = growth(p);
  return g == null ? "no last-year base" : pct(g);
};

/** Groups with a last-year base, best and worst by revenue LFL. */
function extremes(rows: GroupRowDto[], minStores = 1) {
  const ranked = rows
    .filter((r) => r.stores >= minStores && r.sales.ly > 0 && r.sales.ty > 0)
    .map((r) => ({ r, g: growth(r.sales)! }))
    .sort((a, b) => b.g - a.g);
  return { best: ranked[0], worst: ranked.length > 1 ? ranked[ranked.length - 1] : undefined };
}

function storeExtremes(stores: StoreRowDto[], minLy = 100_000) {
  const ranked = stores
    .filter((s) => s.sales.ly >= minLy && s.sales.ty > 0)
    .map((s) => ({ s, g: growth(s.sales)! }))
    .sort((a, b) => b.g - a.g);
  return { best: ranked[0], worst: ranked[ranked.length - 1], ranked };
}

export function summarise(tab: TabKey, d: LflDashboardDto, opts: { concernMonths?: number } = {}): string[] {
  const t = d.totals;
  switch (tab) {
    case "overview": {
      const conv = ratioPair(t.billsWithFootfall, t.footfall);
      const { best, worst } = extremes(d.regions);
      const lines = [
        `Revenue LFL is ${lflText(t.sales)}: ${inr(t.sales.ty)} this year vs ${inr(t.sales.ly)} last year, across ${count(t.stores.ty)} stores.`,
        `Gold ${lflText(t.gold)} and silver ${lflText(t.silver)}; bills (NOB) ${lflText(t.bills)}.`,
        `Conversion is ${share(conv.ty)} (${ptsText(conv.ty != null && conv.ly != null ? conv.ty - conv.ly : null)} vs last year).`,
      ];
      if (best && worst) lines.push(`Strongest region: ${best.r.key} ${pct(best.g)}. Weakest: ${worst.r.key} ${pct(worst.g)}.`);
      return lines;
    }
    case "metal": {
      if (!d.mix.connected) return ["Karat, classic and category sales aren't in the current feed."];
      const goldTotal = d.gold.reduce((n, g) => n + g.sales.ty, 0);
      const topKarat = [...d.gold].filter((g) => g.key !== "UNMAPPED").sort((a, b) => b.sales.ty - a.sales.ty)[0];
      const classic = d.silver.find((s) => s.key === "CLASSIC");
      const silverTotal = d.silver.reduce((n, s) => n + s.sales.ty, 0);
      const cats = d.categories.all.filter((c) => c.key !== "OTHER" && c.sales.ly > 0);
      const topCat = [...d.categories.all].sort((a, b) => b.sales.ty - a.sales.ty)[0];
      const fastest = [...cats].sort((a, b) => growth(b.sales)! - growth(a.sales)!)[0];
      const slowest = [...cats].sort((a, b) => growth(a.sales)! - growth(b.sales)!)[0];
      const lines: string[] = [];
      if (topKarat) lines.push(`${topKarat.label} is the biggest karat: ${share(ratio(topKarat.sales.ty, goldTotal))} of gold sales (${lflText(topKarat.sales)} LFL).`);
      if (classic) lines.push(`Classic silver is ${share(ratio(classic.sales.ty, silverTotal))} of silver sales, ${lflText(classic.sales)} LFL.`);
      if (topCat) lines.push(`Largest category: ${topCat.label}, ${inr(topCat.sales.ty)} (${lflText(topCat.sales)}).`);
      if (fastest && slowest && fastest !== slowest) {
        lines.push(`Fastest growing: ${fastest.label} ${pct(growth(fastest.sales))}. Biggest decline: ${slowest.label} ${pct(growth(slowest.sales))}.`);
      }
      return lines;
    }
    case "age": {
      const lines = d.ages.map((a) =>
        a.comparable !== false && a.sales.ly > 0
          ? `${a.key}: ${count(a.stores)} stores, ${inr(a.sales.ty)}, revenue LFL ${pct(growth(a.sales))}.`
          : `${a.key}: ${count(a.stores)} stores, ${inr(a.sales.ty)} (new, no full last year).`
      );
      return [`Every store is included here, LFL or new.`, ...lines];
    }
    case "cities": {
      const { best, worst } = extremes(d.cities);
      const rest = d.cities.find((c) => c.key === "Rest of India");
      const total = d.cities.reduce((n, c) => n + c.sales.ty, 0);
      const lines: string[] = [];
      if (best && worst) lines.push(`Best city: ${best.r.key} ${pct(best.g)}. Weakest: ${worst.r.key} ${pct(worst.g)}.`);
      if (rest) lines.push(`Rest of India is ${share(ratio(rest.sales.ty, total))} of revenue across ${count(rest.stores)} stores, ${lflText(rest.sales)} LFL.`);
      const metros = d.cities.filter((c) => c.key !== "Rest of India");
      const metroSales = metros.reduce((n, c) => n + c.sales.ty, 0);
      if (metros.length) lines.push(`The 8 metros together: ${inr(metroSales)}, ${share(ratio(metroSales, total))} of revenue.`);
      return lines;
    }
    case "rankings": {
      const ams = extremes(d.ams, 2);
      const st = storeExtremes(d.stores);
      const lines: string[] = [];
      if (ams.best && ams.worst) lines.push(`Top AM: ${ams.best.r.key} ${pct(ams.best.g)} (${ams.best.r.stores} stores). Bottom AM: ${ams.worst.r.key} ${pct(ams.worst.g)}.`);
      if (st.best && st.worst) lines.push(`Top store: ${st.best.s.name} ${pct(st.best.g)}. Bottom store: ${st.worst.s.name} ${pct(st.worst.g)}.`);
      const growing = st.ranked.filter((x) => x.g > 0).length;
      if (st.ranked.length) lines.push(`${growing} of ${st.ranked.length} trading stores are growing (₹1 L+ last year).`);
      return lines;
    }
    case "concerns": {
      const min = opts.concernMonths ?? 3;
      const rows = d.concerns.rows.filter((r) => r.degrowingMonths >= min);
      const span = `${d.concerns.basis === "ytd" ? "calendar" : "financial"} year to date`;
      if (!rows.length) return [`No store has degrown for ${min}+ months this ${span}.`];
      const byRegion = new Map<string, number>();
      for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
      const topRegion = [...byRegion].sort((a, b) => b[1] - a[1])[0]!;
      const worst = rows[0]!;
      return [
        `${rows.length} stores have degrown in ${min} or more months this ${span}.`,
        `Most are in ${topRegion[0]} (${topRegion[1]}).`,
        `Longest run: ${worst.name}, down in ${worst.degrowingMonths} of ${d.concerns.months.length} months (YTD ${lflText(worst.ytd)}).`,
      ];
    }
    case "stores": {
      const lfl = d.allStores.filter((s) => s.isLfl).length;
      const sales = d.allStores.reduce((n, s) => n + s.sales.ty, 0);
      const newSales = d.allStores.filter((s) => !s.isLfl).reduce((n, s) => n + s.sales.ty, 0);
      return [
        `${count(d.allStores.length)} stores: ${count(lfl)} LFL and ${count(d.allStores.length - lfl)} newer stores.`,
        `Newer stores add ${inr(newSales)}, ${share(ratio(newSales, sales))} of revenue in this range.`,
      ];
    }
    case "ops": {
      const lines: string[] = [];
      if (d.inventory.connected && d.inventory.total) {
        lines.push(`${count(d.inventory.total.ty)} units on hand on ${d.inventory.asOf}.`);
        if (d.inventory.total.ly > 0) lines.push(`That's ${pct(growthOf(d.inventory.total.ty, d.inventory.total.ly))} vs a year earlier.`);
      }
      if (d.staff.connected) {
        const s = d.staff;
        const under3 = s.bands.find((b) => b.key === "lt3")?.staff ?? 0;
        lines.push(
          `${count(s.headcount)} active staff, average tenure ${s.avgTenureMonths != null ? `${Math.round(s.avgTenureMonths)} months` : "—"}; ${share(ratio(under3, s.headcount))} joined in the last 3 months.`
        );
        const last = s.monthly[s.monthly.length - 1];
        if (last) lines.push(`In ${last.month.slice(0, 7)}, ${last.joined} joined and ${last.left} left.`);
        if (s.tenureVsSales) lines.push(...tenureVerdict(s.tenureVsSales).slice(0, 2));
      }
      return lines.length ? lines : ["No stock or staff data for this view."];
    }
  }
}

/** Plain answer to "do longer-serving staff sell more?" */
export function tenureVerdict(t: TenureSalesDto): string[] {
  const bands = t.bands.filter((b) => b.staffMonths >= 20);
  if (bands.length < 2) return [];
  const first = bands[0]!;
  const peak = bands.reduce((a, b) => (b.medianSales > a.medianSales ? b : a));
  const last = bands[bands.length - 1]!;
  const r = t.correlation ?? 0;
  const strength = Math.abs(r) < 0.1 ? "barely" : Math.abs(r) < 0.3 ? "only weakly" : "clearly";
  const lines = [
    `${t.role}' median monthly sales go from ${inr(first.medianSales)} (${first.label.toLowerCase()}) to ${inr(peak.medianSales)} (${peak.label.toLowerCase()})` +
      (last !== peak ? `, then ${inr(last.medianSales)} (${last.label.toLowerCase()}).` : "."),
    `Tenure and sales move together ${strength} (rank correlation ${r >= 0 ? "+" : ""}${r.toFixed(2)}), so sales aren't directly proportional to tenure.`,
  ];
  if (t.longerWinsShare != null) {
    lines.push(`In the same store and month, the longer-serving consultant sold more in ${share(t.longerWinsShare, 0)} of ${count(t.pairs)} pairs.`);
  }
  return lines;
}
