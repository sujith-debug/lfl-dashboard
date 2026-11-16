"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LflDashboardDto, Pair, StoreRowDto } from "../../contracts";
import { growth, sumPair } from "../../reports";
import { useLflPage } from "../dashboard/context";
import { count, inr, pct, tone } from "../ui/format";
import { Icon } from "../ui/Icon";
import { Badge, Card } from "../ui/primitives";
import { cityInfo, DEFAULT_REGION, INDIA, project, REGION_LABEL_AT } from "./geo";

/** Map point for a store: its city from the lookup table, else its own coordinates. */
function storePoint(store: StoreRowDto): { x: number; y: number } | null {
  const city = cityInfo(store.city);
  if (city) return city;
  if (store.lat != null && store.lng != null) {
    const [x, y] = project(store.lng, store.lat);
    return { x, y };
  }
  return null;
}

type Box = [number, number, number, number];

// Brand tints (pink, gold, blush, silver) so the four regions read apart at a glance.
const REGION_FILL: Record<string, string> = {
  North: "#f1aebf",
  West: "#ebcf98",
  South: "#f8cbd6",
  East: "#cfd3dc",
};
const FALLBACK_FILL = "#eadfdc";

/** Bounding box of an SVG path made of M/L/Z commands with absolute coordinates. */
function pathBox(d: string): Box | null {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]), y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

const unionBox = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b[0]));
  const minY = Math.min(...boxes.map((b) => b[1]));
  const maxX = Math.max(...boxes.map((b) => b[0] + b[2]));
  const maxY = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [minX, minY, maxX - minX, maxY - minY];
};

const STATE_BOXES = new Map(INDIA.states.map((s) => [s.code, pathBox(s.d)]));
// Small islands far offshore would stretch a zoomed region box; leave them out of zoom maths.
const ZOOM_IGNORE = new Set(["Andaman and Nicobar Islands", "Lakshadweep"]);

/** Animates an SVG viewBox towards `target` with an ease-out curve. */
function useAnimatedBox(target: Box, ms = 550): Box {
  const [box, setBox] = useState<Box>(target);
  const from = useRef<Box>(target);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setBox(target);
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const next = origin.map((v, i) => v + (target[i]! - v) * e) as Box;
      from.current = next;
      setBox(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.join(",")]);
  return box;
}

type CityAgg = {
  name: string;
  region: string;
  x: number;
  y: number;
  stores: StoreRowDto[];
  sales: Pair;
};

function pad(box: Box, fraction: number): Box {
  const [x, y, w, h] = box;
  return [x - w * fraction, y - h * fraction, w * (1 + 2 * fraction), h * (1 + 2 * fraction)];
}

/** Rendered size of an element, kept current as it resizes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width || 800, h: entry.contentRect.height || 500 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function IndiaMap({ data }: { data: LflDashboardDto }) {
  const { filters, setFilters, openStore } = useLflPage();
  const [hover, setHover] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  const [wrap, size] = useSize<HTMLDivElement>();

  const cities = useMemo(() => {
    const byCity = new Map<string, CityAgg & { n: number }>();
    for (const store of data.stores) {
      const point = storePoint(store);
      if (!point) continue;
      const agg = byCity.get(store.city) ?? { name: store.city, region: store.region, x: 0, y: 0, n: 0, stores: [], sales: { ty: 0, ly: 0 } };
      // Cities not in the lookup sit at the average of their stores' positions.
      agg.x = (agg.x * agg.n + point.x) / (agg.n + 1);
      agg.y = (agg.y * agg.n + point.y) / (agg.n + 1);
      agg.n += 1;
      agg.stores.push(store);
      agg.sales = sumPair([agg.sales, store.sales]);
      byCity.set(store.city, agg);
    }
    return [...byCity.values()].sort((a, b) => b.sales.ty - a.sales.ty);
  }, [data.stores]);

  // A state's region comes from its stores where it has any, else the default zone map.
  const stateRegion = useMemo(() => {
    const votes = new Map<string, Map<string, number>>();
    for (const store of data.stores) {
      const info = cityInfo(store.city);
      if (!info) continue;
      const tally = votes.get(info.state) ?? new Map<string, number>();
      tally.set(store.region, (tally.get(store.region) ?? 0) + 1);
      votes.set(info.state, tally);
    }
    const out = new Map<string, string>();
    for (const s of INDIA.states) {
      const tally = votes.get(s.name);
      const top = tally ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0]![0] : DEFAULT_REGION[s.name];
      if (top) out.set(s.name, top);
    }
    return out;
  }, [data.stores]);

  const unmapped = data.stores.filter((s) => !storePoint(s)).length;
  const focusRegion = filters.region ?? (filters.city ? cities.find((c) => c.name === filters.city)?.region : undefined) ?? null;

  const target = useMemo<Box>(() => {
    if (!focusRegion) return INDIA.viewBox;
    const boxes = INDIA.states
      .filter((s) => stateRegion.get(s.name) === focusRegion && !ZOOM_IGNORE.has(s.name))
      .map((s) => STATE_BOXES.get(s.code))
      .filter((b): b is Box => b != null);
    const box = unionBox(boxes);
    return box ? pad(box, 0.08) : INDIA.viewBox;
  }, [focusRegion, stateRegion]);
  const box = useAnimatedBox(target);
  // The SVG letterboxes the view box into the element, so one pixel is the larger of the two ratios.
  const unitsPerPx = Math.max(box[2] / size.w, box[3] / size.h);
  /** Map units that render as `n` screen pixels at the current zoom. */
  const px = (n: number) => n * unitsPerPx;

  // Label each region at its anchor, else the area-weighted centre of its states (India view only).
  const regionLabels = useMemo(() => {
    const acc = new Map<string, { x: number; y: number; w: number }>();
    for (const s of INDIA.states) {
      const region = stateRegion.get(s.name);
      const b = STATE_BOXES.get(s.code);
      if (!region || !b || ZOOM_IGNORE.has(s.name)) continue;
      const weight = b[2] * b[3];
      const a = acc.get(region) ?? { x: 0, y: 0, w: 0 };
      a.x += (b[0] + b[2] / 2) * weight;
      a.y += (b[1] + b[3] / 2) * weight;
      a.w += weight;
      acc.set(region, a);
    }
    return [...acc.entries()].map(([region, a]) => {
      const at = REGION_LABEL_AT[region];
      const [x, y] = at ? project(at.lon, at.lat) : [a.x / a.w, a.y / a.w];
      return { region, x, y };
    });
  }, [stateRegion]);

  const maxSales = Math.max(1, ...cities.map((c) => c.sales.ty));
  const regionRows = data.regions.map((r) => ({ key: r.key, stores: r.stores, sales: r.sales }));

  /** Follows the cursor without touching the text, so it can't overwrite a newer tooltip. */
  const moveTip = (e: React.MouseEvent) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover((h) => (h ? { ...h, x, y } : h));
  };

  const showTip = (e: React.MouseEvent, html: React.ReactNode) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, html });
  };

  const regionCities = focusRegion ? cities.filter((c) => c.region === focusRegion) : [];
  const cityStores = filters.city ? data.stores.filter((s) => s.city === filters.city) : [];
  const listStores = (filters.city ? cityStores : focusRegion ? data.stores : []).slice(0, 8);

  return (
    <Card
      title={focusRegion ? `${focusRegion} region${filters.city ? ` · ${filters.city}` : ""}` : "Store map"}
      subtitle={
        focusRegion
          ? "Dot size is sales, colour is revenue LFL. Click a city to filter, a store to open it."
          : "Click a region to zoom in. Dot size is sales, colour is revenue LFL."
      }
      actions={
        focusRegion ? (
          <button className="btn sm" type="button" onClick={() => setFilters({ region: undefined, city: undefined })}>
            <Icon name="chevronLeft" size={14} /> All India
          </button>
        ) : null
      }
      note={unmapped ? `${unmapped} store${unmapped === 1 ? "" : "s"} in cities the map doesn't know yet aren't shown as dots.` : undefined}
    >
      <div className="map-layout">
        <div className="map-wrap" ref={wrap} onMouseLeave={() => setHover(null)}>
          <svg viewBox={box.join(" ")} role="img" aria-label="Map of India by sales region" className="india">
            <g>
              {INDIA.states.map((s) => {
                const region = stateRegion.get(s.name);
                const inFocus = !focusRegion || region === focusRegion;
                const hot = !focusRegion && region != null && hoverRegion === region;
                return (
                  <path
                    key={s.code}
                    d={s.d}
                    className={`state${inFocus ? "" : " faded"}${hot ? " hot" : ""}${region && !focusRegion ? " clickable" : ""}`}
                    style={{ fill: inFocus ? (hot ? undefined : REGION_FILL[region ?? ""] ?? FALLBACK_FILL) : undefined, strokeWidth: px(0.9) }}
                    onMouseEnter={(e) => {
                      if (!focusRegion) setHoverRegion(region ?? null);
                      const r = data.regions.find((g) => g.key === region);
                      showTip(
                        e,
                        <>
                          <b>{s.name}</b>
                          {region ? (
                            <>
                              <br />
                              {region} region{r ? ` · LFL ${pct(growth(r.sales))}` : ""}
                            </>
                          ) : null}
                        </>
                      );
                    }}
                    onMouseMove={moveTip}
                    onMouseLeave={() => setHoverRegion(null)}
                    onClick={() => region && !focusRegion && setFilters({ region })}
                  />
                );
              })}
            </g>
            {!focusRegion ? (
              <g className="region-labels">
                {regionLabels.map((l) => {
                  const r = data.regions.find((g) => g.key === l.region);
                  if (!r) return null;
                  const g = growth(r.sales);
                  return (
                    <text key={l.region} x={l.x} y={l.y} textAnchor="middle" style={{ fontSize: px(13) }} className="region-label">
                      {l.region}
                      <tspan x={l.x} dy={px(16)} className={`g ${tone(g)}`}>
                        {pct(g)}
                      </tspan>
                    </text>
                  );
                })}
              </g>
            ) : null}
            <g>
              {cities.map((c) => {
                const r = px(4 + 12 * Math.sqrt(c.sales.ty / maxSales));
                const g = growth(c.sales);
                const dim = focusRegion && c.region !== focusRegion;
                const selected = filters.city === c.name;
                return (
                  <g key={c.name} className={`city ${tone(g)}${dim ? " faded" : ""}${selected ? " selected" : ""}`}>
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={r}
                      style={{ strokeWidth: px(selected ? 3 : 1.5) }}
                      onMouseEnter={(e) =>
                        showTip(
                          e,
                          <>
                            <b>{c.name}</b>
                            <br />
                            {c.stores.length} store{c.stores.length === 1 ? "" : "s"} · {inr(c.sales.ty)}
                            <br />
                            LFL {pct(g)}
                          </>
                        )
                      }
                      onMouseMove={moveTip}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilters({ region: c.region, city: selected ? undefined : c.name });
                      }}
                    />
                    {focusRegion && !dim ? (
                      <text x={c.x + r + px(4)} y={c.y + px(4)} style={{ fontSize: px(12) }} className="city-label">
                        {c.name} <tspan className={`g ${tone(g)}`}>{pct(g)}</tspan>
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
          {hover ? (
            <div className="tip" style={{ left: hover.x, top: hover.y - 10 }}>
              {hover.html}
            </div>
          ) : null}
          <div className="map-legend">
            <span><i className="lg pos" /> Growing</span>
            <span><i className="lg neg" /> Degrowing</span>
            <span className="muted">Dot size = sales</span>
          </div>
        </div>

        <div className="map-side">
          {!focusRegion ? (
            <>
              <h3>Regions</h3>
              {regionRows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`map-item${hoverRegion === r.key ? " hot" : ""}`}
                  onMouseEnter={() => setHoverRegion(r.key)}
                  onMouseLeave={() => setHoverRegion(null)}
                  onClick={() => setFilters({ region: r.key })}
                >
                  <span className="swatch" style={{ background: REGION_FILL[r.key] ?? FALLBACK_FILL }} />
                  <span className="name">
                    {r.key}
                    <span className="cell-sub">
                      {count(r.stores)} stores · {inr(r.sales.ty)}
                    </span>
                  </span>
                  <Badge value={growth(r.sales)} />
                  <Icon name="chevronRight" size={14} />
                </button>
              ))}
            </>
          ) : (
            <>
              <h3>Cities</h3>
              {regionCities.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`map-item${filters.city === c.name ? " active" : ""}`}
                  onClick={() => setFilters({ city: filters.city === c.name ? undefined : c.name })}
                >
                  <span className="name">
                    {c.name}
                    <span className="cell-sub">
                      {c.stores.length} store{c.stores.length === 1 ? "" : "s"} · {inr(c.sales.ty)}
                    </span>
                  </span>
                  <Badge value={growth(c.sales)} />
                </button>
              ))}
              {listStores.length ? (
                <>
                  <h3 style={{ marginTop: 12 }}>{filters.city ? `Stores in ${filters.city}` : "Top stores"}</h3>
                  {listStores.map((s) => (
                    <button key={s.id} type="button" className="map-item" onClick={() => openStore(s.id)}>
                      <span className="name">
                        {s.name}
                        <span className="cell-sub">{inr(s.sales.ty)}</span>
                      </span>
                      <Badge value={growth(s.sales)} />
                      <Icon name="chevronRight" size={14} />
                    </button>
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
