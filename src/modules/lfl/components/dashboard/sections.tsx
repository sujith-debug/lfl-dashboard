"use client";

import { useState } from "react";
import type { LflDashboardDto, StaffSalesRowDto, StoreRowDto, TrendGrain } from "../../contracts";
import { dashboardReports, growth, regionsTable, type GroupView, sqftBands, type MetalView, type ReportTable, subregionsTable } from "../../reports";
import { ColumnBars, Donut, GrowthBars, MixBars, PairColumns, ToneColumns } from "../ui/charts";
import { DataTable } from "../ui/DataTable";
import { count, inr, longDate, share, tenure } from "../ui/format";
import { Card, Empty, Growth, Segmented, Stat } from "../ui/primitives";
import { TrendChart, type TrendMetric } from "../ui/TrendChart";
import { useLflPage } from "./context";
import { DownloadMenu } from "./DownloadMenu";
import { ReportCard } from "./ReportCard";
import { IndiaMap } from "../map/IndiaMap";
import { tenureVerdict } from "./summaries";
import { GroupViewToggle, ShareAndGrowth } from "./views";

const METALS: { value: MetalView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
];
const TREND_METRICS: { value: TrendMetric; label: string }[] = [
  { value: "sales", label: "Revenue" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
];
const GRAINS: { value: TrendGrain; label: string }[] = [
  { value: "D", label: "Day" },
  { value: "W", label: "Week" },
  { value: "M", label: "Month" },
];

/** LFL bars per period, shared by the dashboard and the store panel. */
export function TrendCard({ points, store }: { points: LflDashboardDto["trend"]["points"]; store?: string }) {
  const { filters, setFilters } = useLflPage();
  const [metric, setMetric] = useState<TrendMetric>("sales");
  return (
    <Card
      title="LFL growth over time"
      subtitle="This year vs the same days last year"
      actions={
        <>
          <Segmented label="Trend grain" small value={filters.grain} options={GRAINS} onChange={(grain) => setFilters({ grain })} />
          <Segmented label="Trend metric" small value={metric} options={TREND_METRICS} onChange={setMetric} />
          <DownloadMenu report={store ? "store-trend" : "trend"} store={store} label="Download trend" />
        </>
      }
    >
      <TrendChart points={points} metric={metric} />
    </Card>
  );
}

export function OverviewSection({ data }: { data: LflDashboardDto }) {
  const { setFilters } = useLflPage();
  const [regionView, setRegionView] = useState<GroupView>("lfl");
  const [subregionView, setSubregionView] = useState<GroupView>("lfl");
  const reports = dashboardReports(data);
  return (
    <>
      <IndiaMap data={data} />
      <ReportCard table={reports.summary} subtitle="Every headline number, this year vs the same dates last year" />
      <ReportCard table={reports.metals} subtitle="Sales, quantity and average selling price, this year vs last" />
      {data.mix.connected ? <KaratClassicCards gold={reports.gold} silver={reports.silver} /> : null}
      <TrendCard points={data.trend.points} />
      <ReportCard
        table={regionsTable(data, regionView)}
        subtitle="Click a region to filter"
        controls={<GroupViewToggle value={regionView} onChange={setRegionView} />}
        viz={<ShareAndGrowth rows={data.regions} onSelect={(region) => setFilters({ region })} />}
        tableOptions={{ onRowClick: (r) => setFilters({ region: r.key }) }}
      />
      {data.subregions.length > 1 ? (
        <ReportCard
          table={subregionsTable(data, subregionView)}
          subtitle="N1, N2, S1, S2, W1, W2 and East, as GIVA's region-split · click one to filter"
          controls={<GroupViewToggle value={subregionView} onChange={setSubregionView} />}
          viz={<ShareAndGrowth rows={data.subregions} onSelect={(subregion) => setFilters({ subregion })} />}
          tableOptions={{ onRowClick: (r) => setFilters({ subregion: r.key }) }}
        />
      ) : null}
      <div className="grid-2">
        <ReportCard
          table={reports.sqft}
          subtitle="Click a size band to filter"
          viz={
            <GrowthBars
              rows={sqftBands(data.stores).map((b) => ({ key: b.key, label: b.label, value: growth(b.sales) }))}
              onSelect={(sqft) => setFilters({ sqft: sqft as never })}
            />
          }
          tableOptions={{ onRowClick: (b) => setFilters({ sqft: b.key }) }}
        />
      </div>
    </>
  );
}

/** Karat / classic splits and the category table, for the view or for one store. */
export function MetalSection({
  connected = true,
  gold,
  silver,
  categoriesFor,
  store,
}: {
  /** False when the data source has no karat / classic / category split. */
  connected?: boolean;
  gold: ReportTable;
  silver: ReportTable;
  categoriesFor: (metal: MetalView) => ReportTable;
  store?: string;
}) {
  const [metal, setMetal] = useState<MetalView>("all");
  if (!connected) {
    return (
      <Card title="Karat, classic and category" subtitle="Not in the current feed">
        <Empty>
          The LFL feed has gold and silver totals but no split by karat (9 / 14 / 18 Kt), classic vs non-classic,
          or category. Connect the BigQuery feed (or upload sales by store, day, metal, karat or collection, and category)
          and this tab fills in.
        </Empty>
      </Card>
    );
  }
  return (
    <>
      <KaratClassicCards gold={gold} silver={silver} store={store} />
      <ReportCard
        table={categoriesFor(metal)}
        report={store ? "store-categories" : "categories"}
        metal={metal}
        store={store}
        controls={<Segmented label="Metal" small value={metal} options={METALS} onChange={setMetal} />}
        viz={categoryDonut(categoriesFor(metal))}
      />
    </>
  );
}

/** Gold by karat and silver classic vs non-classic, side by side, with TY / LY mix bars. */
export function KaratClassicCards({ gold, silver, store }: { gold: ReportTable; silver: ReportTable; store?: string }) {
  const mix = (table: ReportTable) => (
    <MixBars
      rows={(table.rows as { key: string; label: string; sales: { ty: number; ly: number } }[]).map((r) => ({
        key: r.key,
        label: r.label,
        ty: r.sales.ty,
        ly: r.sales.ly,
      }))}
    />
  );
  return (
    <div className="grid-2">
      <ReportCard table={gold} report={store ? "store-gold" : "gold"} store={store} viz={mix(gold)} />
      <ReportCard table={silver} report={store ? "store-silver" : "silver"} store={store} viz={mix(silver)} />
    </div>
  );
}

/** Category share of sales next to category LFL, above the category table. */
function categoryDonut(table: ReportTable) {
  const rows = table.rows as { key: string; label: string; sales: { ty: number; ly: number } }[];
  const total = rows.reduce((n, r) => n + r.sales.ty, 0);
  if (!rows.length || total <= 0) return null;
  return (
    <div className="viz-2">
      <div>
        <h3>Share of sales</h3>
        <Donut
          rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.sales.ty }))}
          center={{ value: inr(total), label: "this year" }}
          format={inr}
          otherKeys={["OTHER"]}
        />
      </div>
      <div>
        <h3>Sales LFL · top 8 categories</h3>
        <GrowthBars
          rows={[...rows]
            .filter((r) => r.key !== "OTHER")
            .sort((a, b) => b.sales.ty - a.sales.ty)
            .slice(0, 8)
            .map((r) => ({ key: r.key, label: r.label, value: growth(r.sales) }))}
        />
      </div>
    </div>
  );
}

/** Compact TY vs LY store-count strip, always visible above the tabs. */
export function StoreNetworkCard({ data }: { data: LflDashboardDto }) {
  const all = data.allStores;
  const lfl = all.filter((s) => s.isLfl).length;
  const newStores = all.filter((s) => s.sales.ty > 0 && s.sales.ly === 0).length;
  const exited = all.filter((s) => s.sales.ty === 0 && s.sales.ly > 0).length;
  const ty = lfl + newStores;
  const ly = lfl + exited;
  const net = ty - ly;
  const netClass = net > 0 ? "pos" : net < 0 ? "neg" : "";

  return (
    <div className="sn-strip" role="region" aria-label="Store network comparison">
      <span className="sn-title">Store network</span>

      <div className="sn-compare">
        <div className="sn-period">
          <small>TY</small>
          <strong>{ty}</strong>
        </div>
        <span className={`sn-delta ${netClass}`}>
          {net > 0 ? "▲" : net < 0 ? "▼" : "—"} {Math.abs(net)}
        </span>
        <div className="sn-period">
          <small>LY</small>
          <strong>{ly}</strong>
        </div>
      </div>

      <div className="sn-pills">
        <span className="sn-pill" title={`${lfl} stores traded in both years`}>
          <i className="sn-dot" style={{ background: "var(--accent)" }} />
          {lfl} continuing
        </span>
        <span className="sn-pill" title={`${newStores} stores trading TY only`}>
          <i className="sn-dot" style={{ background: "#4caf8a" }} />
          {newStores} new
        </span>
        {exited > 0 ? (
          <span className="sn-pill" title={`${exited} stores that traded LY but not TY`}>
            <i className="sn-dot" style={{ background: "#e05252" }} />
            {exited} exited
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StoresSection({ data }: { data: LflDashboardDto }) {
  const { openStore } = useLflPage();
  return (
    <ReportCard
      table={dashboardReports(data).stores}
      subtitle="Click a store for everything about it"
      tableOptions={{
        sortable: true,
        searchKeys: ["store", "city", "am", "region"],
        searchPlaceholder: "Search store, city or AM",
        pageSize: 25,
        onRowClick: (s: StoreRowDto) => openStore(s.id),
      }}
    />
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) => `${MONTHS_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
/** Leavers over the average of the month's opening and closing headcount. */
const attrition = (m: { headcount: number; joined: number; left: number }) => {
  const opening = m.headcount + m.left - m.joined;
  const avg = (opening + m.headcount) / 2;
  return avg > 0 ? m.left / avg : null;
};

export function OpsSection({ data }: { data: LflDashboardDto }) {
  const [metal, setMetal] = useState<MetalView>("all");
  const reports = dashboardReports(data, metal);
  const inv = data.inventory;
  const staff = data.staff;
  const lastMonth = staff.monthly[staff.monthly.length - 1];
  return (
    <div className="stack">
      {inv.connected && inv.total ? (
        <ReportCard
          table={reports.inventory}
          metal={metal}
          controls={<Segmented label="Metal" small value={metal} options={METALS} onChange={setMetal} />}
          viz={
            <>
              <div className="stats" style={{ padding: "0 0 14px" }}>
                <Stat label="Units on hand" value={count(inv.total.ty)} />
                <Stat label="Counted on" value={longDate(inv.asOf)} />
                {inv.total.ly > 0 ? (
                  <>
                    <Stat label="Last year" value={count(inv.total.ly)} />
                    <Stat label="Δ Inventory" value={<Growth value={growth(inv.total)} />} />
                  </>
                ) : null}
              </div>
              <div className="viz-2">
                <div>
                  <h3>Stock by category</h3>
                  <Donut
                    rows={(reports.inventory.rows as { key: string; label: string; ty: number }[]).map((r) => ({ key: r.key, label: r.label, value: r.ty }))}
                    center={{ value: count(inv.total.ty), label: "units" }}
                    format={(v) => `${count(v)} units`}
                    otherKeys={["OTHER", "Other"]}
                  />
                </div>
                {metal === "all" ? (
                  <div>
                    <h3>Gold vs silver</h3>
                    <Donut
                      rows={(["gold", "silver"] as const).map((m) => ({
                        key: m,
                        label: m === "gold" ? "Gold" : "Silver",
                        value: data.categories[m].reduce((n, c) => n + (c.inventory?.ty ?? 0), 0),
                      }))}
                      center={{ value: count(inv.total.ty), label: "units" }}
                      format={(v) => `${count(v)} units`}
                      colors={{ gold: "#c9962e", silver: "#9aa1ad" }}
                    />
                  </div>
                ) : null}
              </div>
              {inv.total.ly > 0 ? (
                <>
                  <h3 style={{ margin: "16px 0 10px" }}>Δ Inventory vs last year</h3>
                  <GrowthBars
                    rows={(reports.inventory.rows as { key: string; label: string; ty: number; ly: number }[]).map((r) => ({
                      key: r.key,
                      label: r.label,
                      value: r.ly > 0 ? r.ty / r.ly - 1 : null,
                    }))}
                  />
                </>
              ) : (
                <p className="muted" style={{ fontSize: 12, margin: "12px 0 0" }}>
                  Stock counts start on 24 Apr 2026, so there&apos;s no last-year stock to compare yet.
                </p>
              )}
            </>
          }
        />
      ) : (
        <Card title="Inventory">
          <Empty>
            No inventory source is connected. Set <code>LFL_INVENTORY_TABLE</code> to the stock snapshot table to see units on hand.
          </Empty>
        </Card>
      )}
      {staff.connected ? (
        <ReportCard
          table={reports.tenure}
          viz={
            <>
              <div className="stats" style={{ padding: "0 0 4px" }}>
                <Stat label="Active staff" value={count(staff.headcount)} />
                <Stat label="Avg tenure" value={tenure(staff.avgTenureMonths)} />
                {lastMonth ? (
                  <Stat
                    label={`Attrition, ${monthLabel(lastMonth.month)}`}
                    value={share(attrition(lastMonth))}
                    sub={`${lastMonth.left} left · ${lastMonth.joined} joined`}
                  />
                ) : null}
              </div>
              <div className="viz-2" style={{ marginTop: 12 }}>
                <div>
                  <h3>Tenure of active staff</h3>
                  <ColumnBars rows={staff.bands.map((b) => ({ key: b.key, label: b.label, value: b.staff }))} />
                </div>
                {staff.monthly.length ? (
                  <div>
                    <h3>Joined and left, by month</h3>
                    <PairColumns
                      labels={["Joined", "Left"]}
                      rows={staff.monthly.map((m) => ({
                        key: m.month,
                        label: monthLabel(m.month),
                        a: m.joined,
                        b: m.left,
                        note: share(attrition(m)) ?? undefined,
                      }))}
                    />
                  </div>
                ) : null}
              </div>
              {staff.roles.length ? (
                <>
                  <h3 style={{ margin: "18px 0 8px" }}>By role</h3>
                  <table className="mini">
                    <tbody>
                      {staff.roles.slice(0, 6).map((r) => (
                        <tr key={r.role}>
                          <td>{r.role}</td>
                          <td className="num">{count(r.staff)}</td>
                          <td className="num muted">avg {tenure(r.avgTenureMonths)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </>
          }
        />
      ) : (
        <Card title="Staff tenure">
          <Empty>Staff data isn&apos;t available for this source.</Empty>
        </Card>
      )}
      {staff.tenureVsSales ? <TenureSalesCard data={data} /> : null}
      {staff.sales.length ? <StaffSalesCard data={data} /> : null}
    </div>
  );
}

const lakh = (v: number) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v / 1000)} K`);

/** Do longer-serving consultants sell more? Bands, the first year month by month, and a plain answer. */
function TenureSalesCard({ data }: { data: LflDashboardDto }) {
  const t = data.staff.tenureVsSales!;
  const reports = dashboardReports(data);
  const months = t.months.map((m) => longDate(m).replace(/^1 /, ""));
  return (
    <ReportCard
      table={reports.tenuresales}
      subtitle={`${t.role}, ${months[0]}${months.length > 1 ? ` – ${months[months.length - 1]}` : ""} · ${count(t.staffMonths)} person-months`}
      viz={
        <>
          <ul className="verdict">
            {tenureVerdict(t).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="viz-2" style={{ marginTop: 14 }}>
            <div>
              <h3>Median sales per month, by tenure</h3>
              <ToneColumns
                format={lakh}
                rows={t.bands
                  .filter((b) => b.staffMonths)
                  .map((b) => ({ key: b.key, label: b.label, value: b.medianSales, hint: `${b.label}: ${lakh(b.medianSales)} median, ${b.staffMonths} person-months` }))}
              />
            </div>
            <div>
              <h3>First year, month by month</h3>
              <ToneColumns
                format={lakh}
                caption="Month 1 = first full month in the job."
                rows={t.byTenureMonth
                  .filter((m) => m.staffMonths >= 20)
                  .map((m) => ({ key: String(m.month), label: m.label, value: m.medianSales, hint: `Month ${m.label}: ${lakh(m.medianSales)} median, ${m.staffMonths} person-months` }))}
              />
            </div>
          </div>
        </>
      }
    />
  );
}

/** Every salesperson in view with their sales for the date range. */
function StaffSalesCard({ data }: { data: LflDashboardDto }) {
  const { openStore } = useLflPage();
  return (
    <ReportCard
      table={dashboardReports(data).staffsales}
      subtitle="Click a row to open the store"
      tableOptions={{
        sortable: true,
        searchKeys: ["name", "store", "role", "id"],
        searchPlaceholder: "Search staff, store or role",
        pageSize: 25,
        onRowClick: (r: StaffSalesRowDto) => openStore(r.storeId),
      }}
    />
  );
}
