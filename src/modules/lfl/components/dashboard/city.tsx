"use client";

import { useMemo, useState } from "react";
import type { LflDashboardDto, StoreRowDto } from "../../contracts";
import { cityStoresTable, cityTotals, driverAnalysis, MIN_STORES, strength, typeMedians, type DriverKey, type DriverResult } from "../../reports/drivers";
import { Scatter } from "../ui/charts";
import { DataTable } from "../ui/DataTable";
import { count, formatValue, inr, tenure } from "../ui/format";
import { Icon } from "../ui/Icon";
import { Card } from "../ui/primitives";
import { useLflPage } from "./context";
import { KpiGrid } from "./KpiGrid";

const fmt = (format: DriverResult["format"]) => (v: number) =>
  format === "months" ? tenure(v) : format === "inr" ? inr(v) : format === "share" ? formatValue("share", v) : count(v, format === "dec" ? 1 : 0);

/** −0.62 → "−0.62"; null → "—". */
const rho = (r: number | null) => (r == null ? "—" : `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(2)}`);

function Strength({ r }: { r: number | null }) {
  const s = strength(r);
  return (
    <span className={`rho rho-${s === "n/a" ? "na" : s}`} title="Rank correlation with revenue, −1 to +1">
      {s === "n/a" ? "n/a" : `${s} ${rho(r)}`}
    </span>
  );
}

/**
 * One city (metro group) in full: its headline numbers, which factors go with
 * store revenue (across every store in view, and within the city), and each
 * store with the numbers behind it.
 */
export function CityDetail({ city, data, onBack }: { city: string; data: LflDashboardDto; onBack: () => void }) {
  const { openStore } = useLflPage();
  const stores = useMemo(() => data.stores.filter((s) => s.cityGroup === city), [data.stores, city]);
  const ids = useMemo(() => new Set(stores.map((s) => s.id)), [stores]);
  const drivers = useMemo(() => driverAnalysis(data.stores, ids, data.meta.to), [data.stores, ids, data.meta.to]);
  // Open on the factor with the clearest link across the view.
  const strongest = [...drivers].filter((d) => d.r != null).sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!))[0]?.key ?? "footfall";
  const [picked, setPicked] = useState<DriverKey | null>(null);
  const active = drivers.find((d) => d.key === (picked ?? strongest))!;
  const types = typeMedians(stores.length >= MIN_STORES ? stores : data.stores);
  const missingArea = stores.filter((s) => !s.sqft).length;

  return (
    <div className="city-view">
      <header className="city-head">
        <button className="btn sm" type="button" onClick={onBack}>
          <Icon name="chevronLeft" /> All cities
        </button>
        <div>
          <h2>{city}</h2>
          <div className="meta">
            {stores.length} stores in view · {inr(cityTotals(stores).sales.ty)} this year
            {missingArea ? ` · ${missingArea} without a carpet area` : ""}
          </div>
        </div>
      </header>

      <KpiGrid totals={cityTotals(stores)} />

      <Card
        title="What goes with revenue"
        subtitle={`Each dot is a store in view; ${city} stores are highlighted. Click a factor to plot it, or a dot to open the store.`}
        note="Rank correlation (−1 to +1) between each factor and store revenue for the selected dates. It shows what moves together, not what causes what: a busy store may get more staff because it is busy."
      >
        <div className="drivers">
          <table className="driver-list">
            <thead>
              <tr>
                <th>Factor</th>
                <th>All stores in view</th>
                <th>{city}</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.key} className={d.key === active.key ? "on" : undefined} onClick={() => setPicked(d.key)}>
                  <td>
                    <strong>{d.label}</strong>
                  </td>
                  <td>
                    <Strength r={d.r} />
                    <span className="cell-sub">{d.verdict}</span>
                  </td>
                  <td>
                    <Strength r={d.cityR} />
                    <span className="cell-sub">{d.cityVerdict}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="driver-plot">
            <h3>
              Revenue vs {active.label.toLowerCase()} <span className="muted">· {active.n} stores</span>
            </h3>
            <Scatter
              points={active.points.map((p) => ({ ...p, highlight: p.inCity }))}
              xLabel={active.label}
              yLabel="Revenue"
              formatX={fmt(active.format)}
              formatY={inr}
              highlightLabel={city}
              otherLabel="Other stores"
              onSelect={openStore}
            />
            {types.length > 1 ? (
              <div className="type-medians">
                <span className="muted">Median revenue per store{stores.length >= MIN_STORES ? ` in ${city}` : " (all stores in view)"}:</span>
                {types.map((t) => (
                  <span key={t.type}>
                    <strong>{t.type}</strong> {inr(t.median)} <span className="muted">({t.stores})</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={`Stores in ${city}`} subtitle="Click a store for everything about it" note={cityStoresTable(city, stores).description}>
        <DataTable
          table={cityStoresTable(city, stores)}
          sortable
          searchKeys={["store"]}
          searchPlaceholder="Search store"
          onRowClick={(s: StoreRowDto) => openStore(s.id)}
        />
      </Card>
    </div>
  );
}
