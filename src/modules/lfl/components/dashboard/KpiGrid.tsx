"use client";

import type { ReactNode } from "react";
import type { Pair, TrendPointDto } from "../../contracts";
import { Sparkline } from "../ui/charts";
import { count, growth, growthOf, inr, pct, pts, ptsText, ratioPair, share } from "../ui/format";
import { Icon, type IconName } from "../ui/Icon";
import { Badge } from "../ui/primitives";

export type KpiTotals = {
  sales: Pair;
  gold: Pair;
  silver: Pair;
  bills: Pair;
  goldBills: Pair;
  silverBills: Pair;
  footfall: Pair;
  billsWithFootfall: Pair;
  /** Stores trading; omit for a single store (per-store tiles then show raw counts). */
  stores?: Pair;
};

type Tile = { key: string; label: ReactNode; value: ReactNode; foot: ReactNode; spark?: ReactNode };

function series(points: TrendPointDto[] | undefined, metal: "sales" | "gold" | "silver") {
  if (!points || points.length < 2) return null;
  return <Sparkline ty={points.map((p) => p[metal].ty)} ly={points.map((p) => p[metal].ly)} />;
}

/** Headline tiles. Works for the whole view and for one store. */
export function KpiGrid({ totals, trend }: { totals: KpiTotals; trend?: TrendPointDto[] }) {
  const conv = ratioPair(totals.billsWithFootfall, totals.footfall);
  const per = (p: Pair) => (totals.stores ? ratioPair(p, totals.stores) : { ty: p.ty, ly: p.ly });
  const sales = per(totals.sales);
  const bills = per(totals.bills);
  const goldBills = per(totals.goldBills);
  const silverBills = per(totals.silverBills);
  const perLabel = totals.stores ? " / store" : "";

  const metalTile = (key: "sales" | "gold" | "silver", label: ReactNode): Tile => ({
    key,
    label,
    value: inr(totals[key].ty),
    foot: (
      <>
        <Badge value={growth(totals[key])} /> vs {inr(totals[key].ly)} LY
      </>
    ),
    spark: series(trend, key),
  });

  const tiles: Tile[] = [
    metalTile("sales", "Revenue"),
    metalTile(
      "gold",
      <>
        <span className="dot g" /> Gold
      </>
    ),
    metalTile(
      "silver",
      <>
        <span className="dot s" /> Silver
      </>
    ),
    {
      key: "conv",
      label: "Conversion",
      value: share(conv.ty),
      foot: (
        <>
          <Badge value={pts(conv.ty, conv.ly)} points /> vs {share(conv.ly)} LY
        </>
      ),
    },
    {
      key: "sps",
      label: `Sales${perLabel}`,
      value: inr(sales.ty),
      foot: (
        <>
          <Badge value={growthOf(sales.ty, sales.ly)} />
          {` vs ${inr(sales.ly)} LY`}
        </>
      ),
    },
    {
      key: "nob",
      label: `NOB${perLabel}`,
      value: count(bills.ty),
      foot: (
        <>
          <Badge value={growthOf(bills.ty, bills.ly)} /> vs {count(bills.ly)} LY
        </>
      ),
    },
    {
      key: "gnob",
      label: `Gold NOB${perLabel}`,
      value: count(goldBills.ty, totals.stores ? 1 : 0),
      foot: (
        <>
          <Badge value={growthOf(goldBills.ty, goldBills.ly)} /> vs {count(goldBills.ly, totals.stores ? 1 : 0)} LY
        </>
      ),
    },
    {
      key: "snob",
      label: `Silver NOB${perLabel}`,
      value: count(silverBills.ty, totals.stores ? 1 : 0),
      foot: (
        <>
          <Badge value={growthOf(silverBills.ty, silverBills.ly)} /> vs {count(silverBills.ly, totals.stores ? 1 : 0)} LY
        </>
      ),
    },
  ];

  // For one store, "sales per store" is just revenue again.
  const shown = totals.stores ? tiles : tiles.filter((t) => t.key !== "sps");

  return (
    <section className="kpis" aria-label="Headline numbers" title="Compared with the same dates last year (LY)">
      {shown.map((t) => (
        <div className="kpi" key={t.key} data-k={t.key}>
          <span className="k">{t.label}</span>
          <span className="v">{t.value}</span>
          <span className="foot">{t.foot}</span>
          {t.spark}
        </div>
      ))}
    </section>
  );
}

/** A round symmetric limit for the growth axis: the biggest move, rounded up to 10% (5% when small). */
function axisLimit(values: number[]): number {
  const biggest = Math.max(0.05, ...values.map(Math.abs));
  const step = biggest <= 0.2 ? 0.05 : 0.1;
  return Math.ceil((biggest * 1.05) / step) * step;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)}%`;
const arrow = (v: number | null) => (v == null || !Number.isFinite(v) || v === 0 ? "" : v > 0 ? "▲" : "▼");
/** Size of a change without its sign, for use next to ▲ / ▼. */
const magnitude = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : pct(Math.abs(v)).replace(/^[+−-]/, ""));
const direction = (v: number | null) => (v == null || !Number.isFinite(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");

type Metal = "gold" | "silver";
type GrowthRow = { key: string; label: string; icon: IconName | Metal; chip: "rose" | Metal; now: string; was: string; growth: number | null };

/**
 * The headline as a scorecard ("Signal"): colour carries the meaning,
 * green for what grew and red for what fell. Revenue with its gold / silver
 * mix on the left; every metric's change vs last year on one shared,
 * zero-centred axis on the right. Conversion is a rate, so it gets its own
 * points axis underneath rather than sharing the %.
 */
export function KpiScorecard({
  totals,
  trend,
}: {
  totals: KpiTotals & { stores: Pair; goldMtoSales?: Pair; goldMtoBills?: Pair };
  trend?: TrendPointDto[];
}) {
  const per = (p: Pair) => ratioPair(p, totals.stores);
  const conv = ratioPair(totals.billsWithFootfall, totals.footfall);
  const abv = ratioPair(totals.sales, totals.bills);
  const sps = per(totals.sales);
  const nob = per(totals.bills);
  const gnob = per(totals.goldBills);
  const snob = per(totals.silverBills);
  const mix = (p: Pair, period: "ty" | "ly") => (totals.sales[period] > 0 ? p[period] / totals.sales[period] : null);
  const revenueGrowth = growth(totals.sales);

  const rows: GrowthRow[] = [
    { key: "sales", label: "Revenue", icon: "rupee", chip: "rose", now: inr(totals.sales.ty), was: inr(totals.sales.ly), growth: revenueGrowth },
    { key: "gold", label: "Gold", icon: "gold", chip: "gold", now: inr(totals.gold.ty), was: inr(totals.gold.ly), growth: growth(totals.gold) },
    { key: "silver", label: "Silver", icon: "silver", chip: "silver", now: inr(totals.silver.ty), was: inr(totals.silver.ly), growth: growth(totals.silver) },
    { key: "sps", label: "Sales / store", icon: "store", chip: "rose", now: inr(sps.ty), was: inr(sps.ly), growth: growthOf(sps.ty, sps.ly) },
    { key: "nob", label: "NOB / store", icon: "file", chip: "rose", now: count(nob.ty), was: count(nob.ly), growth: growthOf(nob.ty, nob.ly) },
    { key: "gnob", label: "Gold NOB / store", icon: "file", chip: "gold", now: count(gnob.ty, 1), was: count(gnob.ly, 1), growth: growthOf(gnob.ty, gnob.ly) },
    { key: "snob", label: "Silver NOB / store", icon: "file", chip: "silver", now: count(snob.ty, 1), was: count(snob.ly, 1), growth: growthOf(snob.ty, snob.ly) },
  ];
  const values = rows.map((r) => r.growth).filter((v): v is number => v != null && Number.isFinite(v));
  const limit = axisLimit(values);
  const up = values.filter((v) => v > 0).length;
  const down = values.filter((v) => v < 0).length;
  const biggest = [...rows].filter((r) => r.growth != null).sort((a, b) => Math.abs(b.growth!) - Math.abs(a.growth!))[0];

  // Conversion on its own zero-centred axis, in points.
  const convPts = pts(conv.ty, conv.ly);
  const convLimit = Math.max(0.05, Math.abs(convPts ?? 0) * 1.25);

  const bar = (value: number | null, max: number) => {
    if (value == null || !Number.isFinite(value) || value === 0) return null;
    const width = Math.max((Math.min(Math.abs(value), max) / max) * 50, 1.2);
    return <i className={`sg-bar ${value > 0 ? "up" : "down"}`} style={{ width: `${width}%` }} />;
  };
  const chipIcon = (r: GrowthRow) =>
    r.icon === "gold" || r.icon === "silver" ? <span className={`dot ${r.icon === "gold" ? "g" : "s"}`} /> : <Icon name={r.icon} />;

  const stats = [
    { key: "bills", label: "Bills", icon: "file" as IconName, now: count(totals.bills.ty), growth: growth(totals.bills) },
    { key: "abv", label: "Avg bill value", icon: "rupee" as IconName, now: inr(abv.ty), growth: growthOf(abv.ty, abv.ly) },
    { key: "footfall", label: "Footfall", icon: "users" as IconName, now: count(totals.footfall.ty), growth: growth(totals.footfall) },
    { key: "stores", label: "Stores trading", icon: "store" as IconName, now: count(totals.stores.ty), growth: growth(totals.stores) },
  ];
  const mto =
    totals.goldMtoBills && totals.goldMtoSales && totals.goldMtoBills.ty + totals.goldMtoBills.ly > 0
      ? { sales: totals.goldMtoSales, bills: totals.goldMtoBills }
      : null;

  return (
    <section className="scorecard" aria-label="Headline numbers">
      <div className="card sg-hero">
        <div className="sg-top">
          <div>
            <span className="sg-label">Revenue · this period</span>
            <span className="sg-value">{inr(totals.sales.ty)}</span>
            <span className="sg-vs">vs {inr(totals.sales.ly)} last year</span>
          </div>
          <div className={`sg-growth ${direction(revenueGrowth)}`}>
            <span className="n">
              {arrow(revenueGrowth)} {magnitude(revenueGrowth)}
            </span>
            <span className="s">vs last year</span>
          </div>
        </div>

        {/* Gold / silver mix; bar length is revenue, so the overall change shows too. */}
        <div className="sg-mix">
          {(["ty", "ly"] as const).map((period) => {
            const longest = Math.max(totals.sales.ty, totals.sales.ly) || 1;
            const g = mix(totals.gold, period);
            const sv = mix(totals.silver, period);
            return (
              <div className="sg-mix-row" key={period}>
                <span className="yr">{period === "ty" ? "This year" : "Last year"}</span>
                <span className="sg-mix-bar" style={{ width: `${(Math.max(totals.sales[period], 0) / longest) * 100}%` }}>
                  <i className="g" style={{ flexGrow: Math.max(totals.gold[period], 0) }}>
                    {g != null && g >= 0.14 ? `${period === "ty" ? "Gold " : ""}${share(g, 0)}` : ""}
                  </i>
                  <i className="s" style={{ flexGrow: Math.max(totals.silver[period], 0) }}>
                    {sv != null && sv >= 0.14 ? `${share(sv, 0)}${period === "ty" ? " Silver" : ""}` : ""}
                  </i>
                </span>
                <span className="amt">{inr(totals.sales[period])}</span>
              </div>
            );
          })}
        </div>

        <div className="sg-metals">
          {(["gold", "silver"] as const).map((m) => (
            <div className={`sg-metal ${m}`} key={m}>
              <span className="k">
                {m === "gold" ? "Gold" : "Silver"} <Badge value={growth(totals[m])} />
              </span>
              <span className="v">{inr(totals[m].ty)}</span>
              <span className="was">vs {inr(totals[m].ly)}</span>
            </div>
          ))}
        </div>

        {mto ? (
          <div className="sg-mto">
            <span>
              <b>✦ Gold made to order</b> {inr(mto.sales.ty)} · {count(mto.bills.ty)} order{mto.bills.ty === 1 ? "" : "s"}
            </span>
            <Badge value={growth(mto.sales)} />
          </div>
        ) : null}

        <div className="sg-stats">
          {stats.map((st) => (
            <div className={`sg-stat ${direction(st.growth)}`} key={st.key}>
              <span className="ico">
                <Icon name={st.icon} />
              </span>
              <span className="body">
                <span className="k">{st.label}</span>
                <span className="v">{st.now}</span>
              </span>
              <span className="g">
                {arrow(st.growth)} {magnitude(st.growth)}
              </span>
            </div>
          ))}
        </div>

        {trend && trend.length > 1 ? (
          <div className="sg-trend">
            <Sparkline ty={trend.map((p) => p.sales.ty)} ly={trend.map((p) => p.sales.ly)} />
            <span className="sg-vs">— this year · - - last year</span>
          </div>
        ) : null}
      </div>

      <div className="card sg-chart">
        <div className="sg-head">
          <h2>Change vs last year</h2>
          <span className="sub">green grew · red fell</span>
        </div>
        <div className="sg-summary">
          {up ? <span className="pill up">{up} up</span> : null}
          {down ? <span className="pill down">{down} down</span> : null}
          {biggest?.growth != null ? (
            <span className="muted">
              Biggest move: {biggest.label} {pct(biggest.growth)}
            </span>
          ) : null}
        </div>
        <div className="sg-axis" aria-hidden>
          <span />
          <span />
          <span className="r">This period</span>
          <span className="t">
            <span>{signed(-limit)}</span>
            <span>0%</span>
            <span>{signed(limit)}</span>
          </span>
          <span />
        </div>
        {rows.map((r) => (
          <div className={`sg-row ${direction(r.growth)}`} key={r.key} title={`${r.label}: ${r.now} this period vs ${r.was} last year (${pct(r.growth)})`}>
            <span className={`chip ${r.chip}`}>{chipIcon(r)}</span>
            <span className="name">{r.label}</span>
            <span className="now">
              {r.now}
              <small>vs {r.was}</small>
            </span>
            <span className="sg-track">
              <b className="zero" />
              {bar(r.growth, limit)}
            </span>
            <span className="pct">{pct(r.growth)}</span>
          </div>
        ))}
        <div className={`sg-row sg-rate ${direction(convPts)}`} title={`Conversion: ${share(conv.ty)} vs ${share(conv.ly)} last year`}>
          <span className="chip rose">
            <Icon name="users" />
          </span>
          <span className="name">
            Conversion
            <small>points, own axis</small>
          </span>
          <span className="now">
            {share(conv.ty)}
            <small>vs {share(conv.ly)}</small>
          </span>
          <span className="sg-track">
            <b className="zero" />
            {bar(convPts, convLimit)}
          </span>
          <span className="pct">{ptsText(convPts)}</span>
        </div>
      </div>
    </section>
  );
}
