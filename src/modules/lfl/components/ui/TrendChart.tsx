"use client";

import { useEffect, useRef, useState } from "react";
import type { TrendPointDto } from "../../contracts";
import { growth, inr, pct } from "./format";

export type TrendMetric = "sales" | "gold" | "silver";


const L = 52;
const R = 12;
const T = 14;
const B = 34;

function niceStep(span: number, ticks: number) {
  const raw = span / ticks || 0.01;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
}

/** LFL growth per period as bars above (green) or below (red) zero. */
/** Width of an element, kept current as it resizes. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function TrendChart({ points, metric }: { points: TrendPointDto[]; metric: TrendMetric }) {
  // Draw at the real pixel width so labels stay readable on any screen.
  const [wrap, W] = useWidth<HTMLDivElement>(1000);
  const H = W < 600 ? 200 : 240;
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => growth(p[metric]));
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) {
    return <div className="empty" ref={wrap}>No last-year sales to compare against in this range.</div>;
  }

  // Trim extreme spikes (e.g. a store-opening week) so the rest stays readable.
  const sorted = [...finite].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
  let lo = Math.min(0, sorted.length > 12 ? q(0.03) : sorted[0]!);
  let hi = Math.max(0, sorted.length > 12 ? q(0.97) : sorted[sorted.length - 1]!);
  const step = niceStep(hi - lo || 0.1, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;

  const y = (v: number) => T + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (H - T - B);
  const slot = (W - L - R) / points.length;
  const barW = Math.max(1, Math.min(38, slot * 0.7));
  const labelEvery = Math.ceil(points.length / Math.max(3, Math.floor(W / 80)));
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));

  const active = hover != null ? points[hover] : null;
  // Keep the tooltip inside the card near either edge.
  const activeX = hover != null ? Math.min(86, Math.max(14, ((L + slot * hover + slot / 2) / W) * 100)) : 0;

  return (
    <div className="chart" ref={wrap} style={{ padding: "4px 12px 8px" }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="LFL growth by period">
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "zero" : "gridl"} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="axis" x={L - 8} y={y(t) + 3.5} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const v = values[i];
          const x = L + slot * i + (slot - barW) / 2;
          return (
            <g key={p.start}>
              <rect className="hit" x={L + slot * i} y={T} width={slot} height={H - T - B} onMouseEnter={() => setHover(i)} />
              {v != null ? (
                <rect
                  className={v >= 0 ? "bar-pos" : "bar-neg"}
                  x={x}
                  y={Math.min(y(v), y(0))}
                  width={barW}
                  height={Math.max(1, Math.abs(y(v) - y(0)))}
                  rx={Math.min(3, barW / 3)}
                  pointerEvents="none"
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text className="axis" x={L + slot * i + slot / 2} y={H - 12} textAnchor="middle">
                  {p.label.replace("Wk of ", "")}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {active ? (
        <div className="tip" style={{ left: `${activeX}%`, top: 10 }}>
          <b>{active.label}</b>
          <br />
          LFL {pct(growth(active[metric]))}
          <br />
          TY {inr(active[metric].ty)} · LY {inr(active[metric].ly)}
        </div>
      ) : null}
    </div>
  );
}
