"use client";

import { useEffect } from "react";
import type { PeerGroupDto, StoreDetailDto } from "../../contracts";
import { useStoreDetail } from "../../hooks/useLflDashboard";
import { storeReports } from "../../reports";
import { useLflPage } from "../dashboard/context";
import { DownloadMenu } from "../dashboard/DownloadMenu";
import { KpiGrid } from "../dashboard/KpiGrid";
import { MetalSection, TrendCard } from "../dashboard/sections";
import { ReportCard } from "../dashboard/ReportCard";
import { Drawer } from "../ui/Drawer";
import { count, growthOf, inr, longDate, pts, ratio, share } from "../ui/format";
import { Icon } from "../ui/Icon";
import { Card, Growth, Skeleton } from "../ui/primitives";

type Metric = {
  key: string;
  label: string;
  store: number | null;
  peer: (p: PeerGroupDto) => number | null;
  kind: "growth" | "share" | "inr";
  /** For rates, show the store's gap to the group in points rather than %. */
  gapAsPoints?: boolean;
};

function Compare({ detail }: { detail: StoreDetailDto }) {
  const t = detail.totals;
  const sqft = detail.store.sqft;
  const metrics: Metric[] = [
    { key: "lfl", label: "Revenue LFL", kind: "growth", store: growthOf(t.sales.ty, t.sales.ly), peer: (p) => growthOf(p.sales.ty, p.sales.ly), gapAsPoints: true },
    { key: "conv", label: "Conversion", kind: "share", store: ratio(t.billsWithFootfall.ty, t.footfall.ty), peer: (p) => ratio(p.billsWithFootfall.ty, p.footfall.ty), gapAsPoints: true },
    { key: "abv", label: "Avg bill value", kind: "inr", store: ratio(t.sales.ty, t.bills.ty), peer: (p) => ratio(p.sales.ty, p.bills.ty) },
    { key: "sales", label: "Sales", kind: "inr", store: t.sales.ty, peer: (p) => ratio(p.sales.ty, p.stores) },
    { key: "dens", label: "Sales / sq ft", kind: "inr", store: sqft ? t.sales.ty / sqft : null, peer: (p) => ratio(p.salesWithArea, p.sqft) },
  ];
  const show = (m: Metric, v: number | null) =>
    m.kind === "growth" ? <Growth value={v} /> : m.kind === "share" ? share(v) : inr(v);
  const gap = (m: Metric, mine: number | null, theirs: number | null) =>
    m.gapAsPoints ? <Growth value={pts(mine, theirs)} points /> : <Growth value={growthOf(mine, theirs)} />;

  return (
    <Card title="How it compares" subtitle="Peer columns are the average store in each group">
      <div className="card-b">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>This store</th>
              {detail.peers.map((p) => (
                <th key={p.key} title={`${p.stores} stores`}>
                  {p.label}
                </th>
              ))}
              <th title={`Gap to ${detail.peers[0]?.label ?? "region"}`}>Gap to region</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td style={{ fontWeight: 900 }}>{show(m, m.store)}</td>
                {detail.peers.map((p) => (
                  <td key={p.key}>{show(m, m.peer(p))}</td>
                ))}
                <td>{detail.peers[0] ? gap(m, m.store, m.peer(detail.peers[0])) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Header({ detail, storeId }: { detail: StoreDetailDto | null; storeId: string }) {
  if (!detail) {
    return (
      <>
        <Skeleton height={26} width={220} />
        <Skeleton height={18} width={320} />
      </>
    );
  }
  const s = detail.store;
  return (
    <>
      <div className="row" style={{ gap: 10 }}>
        <Icon name="store" size={20} />
        <h2>{s.name}</h2>
        <span className={`tag${s.isLfl ? " accent" : ""}`}>{s.isLfl ? "LFL store" : "Non-LFL store"}</span>
      </div>
      <div className="tags">
        <span className="tag">{s.city}</span>
        <span className="tag">{s.region}</span>
        <span className="tag">AM · {s.am}</span>
        <span className="tag">{s.type}</span>
        <span className="tag">{s.age}</span>
        <span className="tag">{s.sqft ? `${count(s.sqft)} sq ft` : "No carpet area"}</span>
        {s.firstSaleOn ? <span className="tag">Since {longDate(s.firstSaleOn)}</span> : null}
        {s.status === "Closed" ? (
          <span className="tag tag-closed">Closed{s.lastSaleOn ? ` · last sale ${longDate(s.lastSaleOn)}` : ""}</span>
        ) : s.lastSaleOn && s.lastSaleOn < detail.meta.to && (Date.parse(detail.meta.to) - Date.parse(s.lastSaleOn)) / 86_400_000 > 30 ? (
          <span className="tag tag-closed">No sale since {longDate(s.lastSaleOn)} · marked Live</span>
        ) : null}
      </div>
      <div className="row">
        {detail.rank.bySales ? (
          <span className="badge">
            #{detail.rank.bySales} of {detail.rank.of} by sales
          </span>
        ) : (
          <span className="badge">Not in the current filter</span>
        )}
        {detail.rank.byLfl ? (
          <span className="badge">
            #{detail.rank.byLfl} by LFL
          </span>
        ) : null}
        <span className="spacer" />
        <div className="row no-print">
          <button className="btn sm" type="button" onClick={() => window.print()}>
            <Icon name="printer" /> Print
          </button>
          <DownloadMenu report="all" store={storeId} label="Download store report" iconOnly={false} allowCsv={false} />
        </div>
      </div>
    </>
  );
}

/** Everything about one store, in a slide-over. Follows the page's date range and filters. */
export function StoreDrawer({ storeId, onClose }: { storeId: string | null; onClose: () => void }) {
  const { filters } = useLflPage();
  const { data, error, loading, load, reset } = useStoreDetail();

  useEffect(() => {
    if (storeId) void load(storeId, filters);
    else reset();
  }, [storeId, filters, load, reset]);

  const detail = data && data.store.id === storeId ? data : null;
  const reports = detail ? storeReports(detail) : null;

  return (
    <Drawer
      open={storeId !== null}
      onClose={onClose}
      label={detail ? `${detail.store.name} details` : "Store details"}
      header={<Header detail={detail} storeId={storeId ?? ""} />}
    >
      {error ? <div className="callout error">{error}</div> : null}
      {!detail ? (
        error ? null : (
          <>
            <Skeleton height={110} />
            <Skeleton height={220} />
            <Skeleton height={260} />
          </>
        )
      ) : (
        <div className={loading ? "dim stack" : "stack"} style={{ gap: 16 }}>
          <KpiGrid totals={detail.totals} trend={detail.trend.points} />
          <Compare detail={detail} />
          <TrendCard points={detail.trend.points} store={detail.store.id} />
          <MetalSection
            connected={detail.mix.connected}
            gold={reports!["store-gold"]}
            silver={reports!["store-silver"]}
            categoriesFor={(metal) => storeReports(detail, metal)["store-categories"]}
            store={detail.store.id}
          />
          {detail.staff.connected ? (
            <ReportCard table={reports!["store-staff"]} report="store-staff" store={detail.store.id} />
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
