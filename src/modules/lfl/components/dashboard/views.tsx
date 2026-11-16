"use client";

import { useState } from "react";
import type { ConcernRowDto, GroupRowDto, LflDashboardDto, Pair, StoreRowDto } from "../../contracts";
import { agesTable, citiesTable, concernsTable, dashboardReports, groupTable, growth, monthName, type GroupView, type ReportTable } from "../../reports";
import type { TabKey } from "../tabs";
import { Donut, GrowthBars, ToneColumns } from "../ui/charts";
import { DataTable } from "../ui/DataTable";
import { inr, tone, pct } from "../ui/format";
import { Icon } from "../ui/Icon";
import { Card, Segmented } from "../ui/primitives";
import { useLflPage } from "./context";
import { DownloadMenu } from "./DownloadMenu";
import { ReportCard } from "./ReportCard";
import { CityDetail } from "./city";
import { summarise } from "./summaries";

/** A few plain sentences describing what the current tab shows. */
export function ViewSummary({ tab, data, concernMonths }: { tab: TabKey; data: LflDashboardDto; concernMonths?: number }) {
  const lines = summarise(tab, data, { concernMonths });
  if (!lines.length) return null;
  return (
    <section className="summary" aria-label="Summary">
      <Icon name="info" />
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

const GROUP_VIEWS: { value: GroupView; label: string }[] = [
  { value: "lfl", label: "LFL" },
  { value: "perStore", label: "Per store" },
];

/** LFL growth columns, or per-store sales / NOB / gold NOB and conversion. */
export function GroupViewToggle({ value, onChange }: { value: GroupView; onChange: (v: GroupView) => void }) {
  return <Segmented label="Columns" small value={value} options={GROUP_VIEWS} onChange={onChange} />;
}

const groupBars = (rows: GroupRowDto[]) =>
  rows.map((r) => ({ key: r.key, label: r.key, value: r.comparable === false ? null : growth(r.sales) }));

/** Share of revenue (ring) next to revenue LFL (bars), for any grouping of stores. */
export function ShareAndGrowth({
  rows,
  onSelect,
  otherKeys,
  max,
}: {
  rows: GroupRowDto[];
  onSelect?: (key: string) => void;
  otherKeys?: string[];
  max?: number;
}) {
  const total = rows.reduce((n, r) => n + r.sales.ty, 0);
  return (
    <div className="viz-2">
      <div>
        <h3>Share of revenue</h3>
        <Donut
          rows={rows.map((r) => ({ key: r.key, label: r.key, value: r.sales.ty }))}
          center={{ value: inr(total), label: "this year" }}
          format={inr}
          otherKeys={otherKeys}
          max={max}
        />
      </div>
      <div>
        <h3>Revenue LFL</h3>
        <GrowthBars rows={groupBars(rows)} onSelect={onSelect} />
      </div>
    </div>
  );
}

export function AgeSection({ data }: { data: LflDashboardDto }) {
  const { openStore } = useLflPage();
  const [band, setBand] = useState<string | null>(null);
  const [view, setView] = useState<GroupView>("lfl");
  const reports = dashboardReports(data);
  const stores = reports.stores as ReportTable<StoreRowDto>;
  const inBand = band ? data.allStores.filter((s) => s.age === band) : [];
  const pick = (key: string) => setBand((current) => (current === key ? null : key));
  return (
    <>
      <ReportCard
        table={agesTable(data, view)}
        controls={<GroupViewToggle value={view} onChange={setView} />}
        subtitle="Click an age band to see its stores"
        viz={<ShareAndGrowth rows={data.ages} onSelect={pick} />}
        tableOptions={{ onRowClick: (r: GroupRowDto) => pick(r.key) }}
      />
      {band ? (
        <ReportCard
          table={{ ...stores, key: "age-stores", title: `${band} · ${inBand.length} stores`, rows: inBand }}
          report="stores"
          subtitle={band === "Under 12 months" ? "New stores: no full last year, so LFL shows as a dash" : "Click a store for everything about it"}
          controls={
            <button className="btn sm" type="button" onClick={() => setBand(null)}>
              <Icon name="x" /> Close
            </button>
          }
          tableOptions={{
            sortable: true,
            searchKeys: ["store", "city", "am", "region"],
            searchPlaceholder: "Search store, city or AM",
            pageSize: 25,
            onRowClick: (s: StoreRowDto) => openStore(s.id),
          }}
        />
      ) : null}
    </>
  );
}

export function CitiesSection({ data }: { data: LflDashboardDto }) {
  const [view, setView] = useState<GroupView>("lfl");
  const [city, setCity] = useState<string | null>(null);
  if (city) return <CityDetail city={city} data={data} onBack={() => setCity(null)} />;
  return (
    <ReportCard
      table={citiesTable(data, view)}
      controls={<GroupViewToggle value={view} onChange={setView} />}
      subtitle="Eight metros and the rest of India · click a city for its stores and what goes with their revenue"
      viz={<ShareAndGrowth rows={data.cities} otherKeys={["Rest of India"]} max={9} onSelect={setCity} />}
      tableOptions={{ onRowClick: (r: GroupRowDto) => setCity(r.key) }}
    />
  );
}

type RankMetric = "sales" | "gold" | "silver" | "bills";
const RANK_METRICS: { value: RankMetric; label: string }[] = [
  { value: "sales", label: "Revenue" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
  { value: "bills", label: "NOB" },
];
const RANK_LABEL: Record<RankMetric, string> = { sales: "revenue", gold: "gold", silver: "silver", bills: "bills (NOB)" };
/** Stores need this much last-year revenue to be ranked, so tiny bases don't top the list. */
const MIN_STORE_LY = 100_000;
const LFL_BANDS = [
  { key: "lt50", label: "Below −50%", min: -Infinity, max: -0.5, tone: "neg" as const },
  { key: "50-25", label: "−50 to −25%", min: -0.5, max: -0.25, tone: "neg" as const },
  { key: "25-0", label: "−25 to 0%", min: -0.25, max: 0, tone: "neg" as const },
  { key: "0-25", label: "0 to +25%", min: 0, max: 0.25, tone: "pos" as const },
  { key: "gt25", label: "Above +25%", min: 0.25, max: Infinity, tone: "pos" as const },
];
const MIN_AM_STORES = 2;

function rank<T>(rows: T[], pair: (row: T) => Pair, side: "top" | "bottom", n = 10): T[] {
  return rows
    // Trading both years: a closed store's −100% says nothing about performance.
    .filter((r) => pair(r).ly > 0 && pair(r).ty > 0)
    .sort((a, b) => (growth(pair(b))! - growth(pair(a))!) * (side === "top" ? 1 : -1))
    .slice(0, n);
}

export function RankingsSection({ data }: { data: LflDashboardDto }) {
  const { openStore } = useLflPage();
  const [metric, setMetric] = useState<RankMetric>("sales");
  const stores = dashboardReports(data).stores as ReportTable<StoreRowDto>;
  const storeCols = stores.columns.filter((c) => ["store", "sales", "lfl", "gold", "silver"].includes(c.key));
  const eligibleAms = data.ams.filter((a) => a.stores >= MIN_AM_STORES);
  const eligibleStores = data.stores.filter((s) => s.sales.ly >= MIN_STORE_LY);

  const amCard = (side: "top" | "bottom") => {
    const table = groupTable(`ams-${side}`, side === "top" ? "Top 10 AMs" : "Bottom 10 AMs", "AM / CM", rank(eligibleAms, (a) => a[metric], side));
    return (
      <Card title={table.title} subtitle={`By ${RANK_LABEL[metric]} LFL · AMs with ${MIN_AM_STORES}+ trading stores`}>
        <DataTable table={{ ...table, total: undefined, columns: table.columns.filter((c) => c.key !== "silver" && c.key !== "sku") }} />
      </Card>
    );
  };
  const storeCard = (side: "top" | "bottom") => {
    const table: ReportTable<StoreRowDto> = {
      ...stores,
      key: `stores-${side}`,
      title: side === "top" ? "Top 10 stores" : "Bottom 10 stores",
      rows: rank(eligibleStores, (s) => s[metric], side),
      columns: storeCols,
    };
    return (
      <Card title={table.title} subtitle={`By ${RANK_LABEL[metric]} LFL · trading stores with ₹1 L+ last year`}>
        <DataTable table={table} onRowClick={(s) => openStore(s.id)} />
      </Card>
    );
  };

  const spread = LFL_BANDS.map((b) => {
    const n = eligibleStores.filter((s) => {
      const g = s[metric].ly > 0 && s[metric].ty > 0 ? growth(s[metric]) : null;
      return g != null && g >= b.min && g < b.max;
    }).length;
    return { key: b.key, label: b.label, value: n, tone: b.tone, hint: `${n} stores with ${RANK_LABEL[metric]} LFL ${b.label}` };
  });
  const counted = spread.reduce((n, b) => n + b.value, 0);
  const growing = spread.filter((b) => b.tone === "pos").reduce((n, b) => n + b.value, 0);
  return (
    <>
      <div className="section-bar">
        <Segmented label="Rank by" value={metric} options={RANK_METRICS} onChange={setMetric} />
        <DownloadMenu report="ams" label="Download all AMs" />
      </div>
      <Card title="How stores are spread" subtitle={`Trading stores by ${RANK_LABEL[metric]} LFL`}>
        <div className="card-viz">
          <ToneColumns rows={spread} caption={`${growing} of ${counted} stores are growing; ${counted - growing} are below last year.`} />
        </div>
      </Card>
      <div className="grid-2">
        {amCard("top")}
        {amCard("bottom")}
      </div>
      <div className="grid-2">
        {storeCard("top")}
        {storeCard("bottom")}
      </div>
    </>
  );
}

const MIN_MONTH_OPTIONS = [
  { value: "2", label: "2+ months" },
  { value: "3", label: "3+ months" },
  { value: "4", label: "4+ months" },
  { value: "6", label: "6+ months" },
];
const BASIS_OPTIONS = [
  { value: "ytd" as const, label: "Calendar YTD" },
  { value: "fytd" as const, label: "Financial YTD" },
];

/** Quick filters inside the concern list (on top of the page filters). */
const CONCERN_FILTERS = [
  { key: "region", label: "Region", all: "All regions", value: (r: ConcernRowDto) => r.region },
  { key: "city", label: "City", all: "All cities", value: (r: ConcernRowDto) => r.city },
  { key: "am", label: "AM / CM", all: "All AMs", value: (r: ConcernRowDto) => r.am },
  { key: "age", label: "Store age", all: "All ages", value: (r: ConcernRowDto) => r.age },
  { key: "type", label: "Store type", all: "All types", value: (r: ConcernRowDto) => r.type },
] as const;
type ConcernFilterKey = (typeof CONCERN_FILTERS)[number]["key"];

/** One small square per month: red when the store sold less than last year. */
function MonthStrip({ row }: { row: ConcernRowDto }) {
  return (
    <span className="months">
      {row.months.map((m) => (
        <span key={m.month} className={`m ${m.lfl == null ? "na" : tone(m.lfl)}`} title={`${monthName(m.month)}: ${pct(m.lfl)}`} />
      ))}
    </span>
  );
}

export function ConcernsSection({
  data,
  minMonths,
  onMinMonths,
}: {
  data: LflDashboardDto;
  minMonths: number;
  onMinMonths: (n: number) => void;
}) {
  const { filters, setFilters, openStore } = useLflPage();
  const [local, setLocal] = useState<Partial<Record<ConcernFilterKey, string>>>({});
  const base = concernsTable(data, minMonths);
  const table = {
    ...base,
    rows: base.rows.filter((r) => CONCERN_FILTERS.every((f) => !local[f.key] || f.value(r) === local[f.key])),
  };
  const options = (f: (typeof CONCERN_FILTERS)[number]) => [...new Set(base.rows.map(f.value))].sort();
  const toolbar = (
    <>
      {CONCERN_FILTERS.map((f) => (
        <label className="field inline" key={f.key}>
          <select
            aria-label={f.label}
            value={local[f.key] ?? ""}
            onChange={(e) => setLocal((cur) => ({ ...cur, [f.key]: e.target.value || undefined }))}
          >
            <option value="">{f.all}</option>
            {options(f).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}
      {Object.values(local).some(Boolean) ? (
        <button className="btn sm ghost" type="button" onClick={() => setLocal({})}>
          <Icon name="reset" /> Clear
        </button>
      ) : null}
      <span className="muted" style={{ fontSize: 12 }}>
        {table.rows.length} of {base.rows.length} stores
      </span>
    </>
  );
  const months = data.concerns.months;
  const perMonth = months.map((m, i) => {
    const n = table.rows.filter((r) => (r.months[i]?.lfl ?? 0) < 0).length;
    return { key: m, label: monthName(m), value: n, tone: "neg" as const, hint: `${monthName(m)}: ${n} stores below last year` };
  });
  const stripLabel = months.length ? `${monthName(months[0]!)} – ${monthName(months[months.length - 1]!)}` : "Months";
  return (
    <ReportCard
      table={table}
      report="concerns"
      subtitle={`Stores selling less than last year in ${minMonths} or more months`}
      viz={
        table.rows.length ? (
          <>
            <h3>Stores below last year, by month</h3>
            <ToneColumns rows={perMonth} caption={`Of the ${table.rows.length} stores listed below.`} />
          </>
        ) : null
      }
      controls={
        <>
          <Segmented
            label="Year to date"
            small
            value={filters.concernBasis}
            options={BASIS_OPTIONS}
            onChange={(concernBasis) => setFilters({ concernBasis })}
          />
          <Segmented label="Minimum months" small value={String(minMonths)} options={MIN_MONTH_OPTIONS} onChange={(v) => onMinMonths(Number(v))} />
        </>
      }
      tableOptions={{
        sortable: true,
        pageSize: 25,
        searchKeys: ["store", "city", "am", "region"],
        searchPlaceholder: "Search store, city or AM",
        toolbar,
        onRowClick: (r: ConcernRowDto) => openStore(r.id),
        empty: "No store matches. Try fewer filters or fewer months.",
        extraColumn: { label: stripLabel, render: (r: ConcernRowDto) => <MonthStrip row={r} /> },
      }}
    />
  );
}
