"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LflDashboardDto, LflFilters } from "../../contracts";
import { exportHref, toSearchParams, useLflDashboard } from "../../hooks/useLflDashboard";
import { dashboardReports } from "../../reports";
import { defaultFilters } from "../ranges";
import { StoreDrawer } from "../store/StoreDrawer";
import { TABS, type TabKey } from "../tabs";
import { longDate } from "../ui/format";
import { Icon, type IconName } from "../ui/Icon";
import { Menu, Skeleton } from "../ui/primitives";
import { LflProvider, type LflPageContext } from "./context";
import { FilterBar } from "./FilterBar";
import { festivalCompare } from "../festivals";
import { KpiScorecard } from "./KpiGrid";
import { ReportCard } from "./ReportCard";
import { MetalSection, OpsSection, OverviewSection, StoresSection } from "./sections";
import { AskData } from "./AskData";
import { TopBar } from "./TopBar";
import { AgeSection, CitiesSection, ConcernsSection, RankingsSection, ViewSummary } from "./views";
import "../lfl.css";

const THEME_KEY = "lfl-theme";
/** Whether this viewer last left the filter panel open; closed by default. */
const FILTERS_KEY = "lfl-filters-open";
const TAB_ICONS: Record<TabKey, IconName> = {
  overview: "chart",
  metal: "gem",
  age: "clock",
  cities: "pin",
  rankings: "trophy",
  concerns: "alert",
  stores: "store",
  ops: "box",
};

function readTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

type Props = {
  userName: string;
  today: string;
  initialFilters: LflFilters;
  initialData: LflDashboardDto | null;
  initialError: string | null;
  initialTab?: TabKey;
  initialStore?: string;
};

function LoadingView() {
  return (
    <>
      <div className="kpis">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} height={112} radius={16} />
        ))}
      </div>
      <Skeleton height={44} width={420} radius={12} />
      <Skeleton height={300} radius={16} />
    </>
  );
}

export function LflDashboard({
  userName,
  today,
  initialFilters,
  initialData,
  initialError,
  initialTab = "overview",
  initialStore,
}: Props) {
  const [filters, setFilters] = useState<LflFilters>(initialFilters);
  const festival = filters.festival ? festivalCompare(filters.festival, today) : null;
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [store, setStore] = useState<string | null>(initialStore ?? null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [concernMonths, setConcernMonths] = useState(3);
  const { data, error, loading, load } = useLflDashboard(initialData, initialError);
  // "31 Oct 2026 – 1 Nov 2026 vs 31 Oct 2025 – 1 Nov 2025", with the festival or custom tag once its data is in.
  const period = data ? (
    <>
      {festival && data.meta.from === filters.from && data.meta.to === filters.to ? (
        <strong className="festival-tag">{festival.label}</strong>
      ) : !filters.festival && filters.lyFrom && data.meta.lyFrom === filters.lyFrom ? (
        <strong className="festival-tag custom">Custom comparison</strong>
      ) : null}
      {`${longDate(data.meta.from)} – ${longDate(data.meta.to)} vs ${longDate(data.meta.lyFrom)} – ${longDate(data.meta.lyTo)}`}
      {festival?.partial ? " · so far" : ""}
      {festival?.upcoming && data.meta.from === filters.from ? ` · this year's is on ${longDate(festival.upcoming)}` : ""}
    </>
  ) : (
    "Loading…"
  );

  useEffect(() => setTheme(readTheme()), []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    try {
      setFiltersOpen(window.localStorage.getItem(FILTERS_KEY) === "1");
    } catch {
      // Storage blocked: stay closed.
    }
  }, []);
  const toggleFilters = () =>
    setFiltersOpen((open) => {
      try {
        window.localStorage.setItem(FILTERS_KEY, open ? "0" : "1");
      } catch {
        // Not remembered; fine.
      }
      return !open;
    });

  // Keep the URL shareable (filters, tab, open store) without new history entries.
  useEffect(() => {
    const params = toSearchParams(filters);
    if (tab !== "overview") params.set("tab", tab);
    if (store) params.set("store", store);
    window.history.replaceState(null, "", `?${params}`);
  }, [filters, tab, store]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: the choice just won't persist.
    }
  }

  const apply = useCallback(
    (next: LflFilters) => {
      setFilters(next);
      void load(next);
    },
    [load]
  );

  const page: LflPageContext = useMemo(
    () => ({
      filters,
      setFilters: (patch) => apply({ ...filters, ...patch }),
      openStore: setStore,
    }),
    [filters, apply]
  );

  // Report rows are reused by several sections; build them once per response.
  const reports = useMemo(() => (data ? dashboardReports(data) : null), [data]);

  const storeCounts = useMemo(() => {
    if (!data) return undefined;
    const all = data.allStores;
    const lfl = all.filter((s) => s.isLfl).length;
    const newStores = all.filter((s) => s.sales.ty > 0 && s.sales.ly === 0).length;
    const exited = all.filter((s) => s.sales.ty === 0 && s.sales.ly > 0).length;
    return { lfl, newStores, exited };
  }, [data]);

  return (
    <LflProvider value={page}>
      <div className="lfl" data-theme={theme}>
        <TopBar name={userName} source={data?.meta.source ?? null} loading={loading} theme={theme} onToggleTheme={toggleTheme} period={period} storeCounts={storeCounts} />
        <main className="page">
          <header className="page-head">
            <div>
              <h1>Like-for-like performance</h1>
              {/* Small screens: the top bar has no room, so the period sits under the title. */}
              <div className="meta period-under-title">{period}</div>
            </div>
            <div className="row no-print">
              <AskData filters={filters} />
              <button className="btn" type="button" onClick={() => window.print()}>
                <Icon name="printer" /> Print / PDF
              </button>
              <Menu label="Download report" icon="download" buttonClass="btn primary">
                {(close) => (
                  <>
                    <div className="head">
                      Everything in view<b>Full report</b>
                    </div>
                    <a className="menu-item" role="menuitem" download href={exportHref(filters, { report: "all", format: "xlsx" })} onClick={close}>
                      <Icon name="sheet" /> All reports, one workbook <span className="hint">.xlsx</span>
                    </a>
                    <hr />
                    <div className="head">One report as CSV</div>
                    {(["summary", "metals", "stores", "regions", "cities", "ages", "ams", "concerns", "categories", "gold", "silver", "trend"] as const).map((key) => (
                      <a
                        key={key}
                        className="menu-item"
                        role="menuitem"
                        download
                        href={exportHref(filters, { report: key, format: "csv" })}
                        onClick={close}
                      >
                        <Icon name="file" /> {reports?.[key].title.split(" · ")[0] ?? key}
                        <span className="hint">.csv</span>
                      </a>
                    ))}
                  </>
                )}
              </Menu>
            </div>
          </header>

          <FilterBar
            open={filtersOpen}
            onToggle={toggleFilters}
            filters={filters}
            options={data?.options ?? null}
            today={today}
            storeCount={data?.meta.storeCount ?? null}
            onChange={page.setFilters}
            onReset={() => apply(defaultFilters(today))}
          />

          {loading && data && (data.meta.from !== filters.from || data.meta.to !== filters.to || data.meta.lyFrom !== (filters.lyFrom ?? data.meta.lyFrom)) ? (
            <div className="callout loading-note" role="status">
              <span className="spin" aria-hidden /> Loading {festival?.label ?? "the new dates"} from BigQuery. Dates nobody has opened yet take up to a minute; after
              that they&apos;re quick. The numbers below are still the previous view.
            </div>
          ) : null}
          {error ? (
            <div className="callout error" role="alert">
              <Icon name="info" /> {error}
            </div>
          ) : null}
          {data?.meta.notes.length ? (
            <div className="callout warn">
              <Icon name="info" />
              <ul>
                {data.meta.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data ? (
            <div className={loading ? "stack dim" : "stack"}>
              <KpiScorecard totals={data.totals} trend={data.trend.points} />

              <nav className="tabs" role="tablist" aria-label="Dashboard sections">
                {TABS.map((t) => (
                  <button key={t.key} className="tab" role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                    <Icon name={TAB_ICONS[t.key]} /> {t.label}
                  </button>
                ))}
              </nav>

              <div role="tabpanel" className="stack">
                <ViewSummary tab={tab} data={data} concernMonths={concernMonths} />
                {tab === "overview" ? <OverviewSection data={data} /> : null}
                {tab === "metal" && reports ? <ReportCard table={reports.metals} subtitle="Sales, quantity and average selling price, this year vs last" /> : null}
                {tab === "metal" && reports ? (
                  <MetalSection
                    connected={data.mix.connected}
                    gold={reports.gold}
                    silver={reports.silver}
                    categoriesFor={(metal) => dashboardReports(data, metal).categories}
                  />
                ) : null}
                {tab === "age" ? <AgeSection data={data} /> : null}
                {tab === "cities" ? <CitiesSection data={data} /> : null}
                {tab === "rankings" ? <RankingsSection data={data} /> : null}
                {tab === "concerns" ? <ConcernsSection data={data} minMonths={concernMonths} onMinMonths={setConcernMonths} /> : null}
                {tab === "stores" ? <StoresSection data={data} /> : null}
                {tab === "ops" ? <OpsSection data={data} /> : null}
              </div>
            </div>
          ) : error ? null : (
            <LoadingView />
          )}
        </main>
        <StoreDrawer storeId={store} onClose={() => setStore(null)} />
      </div>
    </LflProvider>
  );
}
