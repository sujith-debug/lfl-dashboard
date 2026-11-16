"use client";

import { useRef, useState } from "react";
import { pct, ptsText, tone } from "./format";

/** Horizontal growth bars around a zero line, one row per item. */
export function GrowthBars({
  rows,
  points = false,
  onSelect,
}: {
  rows: { key: string; label: string; value: number | null }[];
  points?: boolean;
  onSelect?: (key: string) => void;
}) {
  const values = rows.map((r) => r.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) {
    return <div className="muted" style={{ fontSize: 12.5 }}>No last-year base to compare against.</div>;
  }
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const zeroAt = (-lo / span) * 100;
  const text = (v: number | null) => (points ? ptsText(v) : pct(v));
  return (
    <div className="hb">
      {rows.map((row) => {
        const v = row.value;
        const width = v == null ? 0 : (Math.abs(v) / span) * 100;
        const left = v == null || v >= 0 ? zeroAt : zeroAt - width;
        return (
          <div
            className={`hb-row${onSelect ? " clickable" : ""}`}
            key={row.key}
            title={`${row.label}: ${text(v)}`}
            onClick={onSelect ? () => onSelect(row.key) : undefined}
          >
            <span className="hb-l">{row.label}</span>
            <span className="hb-t">
              {v != null ? (
                <span className={`hb-b ${v >= 0 ? "bar-pos" : "bar-neg"}`} style={{ left: `${left}%`, width: `${width}%` }} />
              ) : null}
              <span className="hb-z" style={{ left: `${zeroAt}%` }} />
            </span>
            <span className={`hb-v g ${tone(v)}`}>{text(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

const MIX_COLORS = ["#bc4263", "#e9718b", "#f4a9ba", "#b57e10", "#9aa1ad"];

/** Two stacked share bars (TY above LY) so a change in mix reads at a glance. */
export function MixBars({ rows }: { rows: { key: string; label: string; ty: number; ly: number }[] }) {
  const totals = {
    ty: rows.reduce((sum, r) => sum + r.ty, 0),
    ly: rows.reduce((sum, r) => sum + r.ly, 0),
  };
  return (
    <div>
      <div className="mix">
        {(["ty", "ly"] as const).map((period) => (
          <div className="mix-row" key={period}>
            <span>{period.toUpperCase()}</span>
            <div className="mix-bar">
              {rows.map((row, i) => {
                const part = totals[period] > 0 ? row[period] / totals[period] : 0;
                return part > 0 ? (
                  <span
                    key={row.key}
                    title={`${row.label}: ${(part * 100).toFixed(1)}%`}
                    style={{ width: `${part * 100}%`, background: MIX_COLORS[i % MIX_COLORS.length] }}
                  >
                    {part >= 0.09 ? `${Math.round(part * 100)}%` : ""}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        {rows.map((row, i) => (
          <span key={row.key}>
            <i style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
            {row.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical count bars, e.g. staff per tenure band. */
export function ColumnBars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const peak = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="colbars">
      {rows.map((r) => (
        <div className="colbar" key={r.key}>
          <span className="cnt">{r.value}</span>
          <span className="bar" style={{ height: `${(r.value / peak) * 80}%` }} />
          <span className="lab">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Tiny area line of this year's values, last year's as a dashed line. */
export function Sparkline({ ty, ly }: { ty: number[]; ly?: number[] }) {
  if (ty.length < 2) return <div className="spark" />;
  const all = [...ty, ...(ly ?? [])];
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const W = 120;
  const H = 30;
  const x = (i: number) => (i / (ty.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const tyPath = line(ty);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden width="100%">
      <path d={`${tyPath} L${W},${H} L0,${H} Z`} fill="var(--accent-soft)" />
      {ly && ly.length === ty.length ? (
        <path d={line(ly)} fill="none" stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : null}
      <path d={tyPath} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const DONUT_COLORS = ["#bc4263", "#e9718b", "#b57e10", "#f4a9ba", "#7a2a40", "#e1bf7c", "#d98a5f", "#8c5a6b", "#c98fa0"];
const DONUT_OTHER = "#c9bfc2";

/**
 * Share of a whole as a ring, with a legend of label · share. Small slices
 * past `max` are folded into "Other" so the ring stays readable.
 */
export function Donut({
  rows,
  center,
  format = (v) => v.toLocaleString("en-IN"),
  max = 7,
  otherKeys = [],
  colors = {},
}: {
  rows: { key: string; label: string; value: number }[];
  center?: { value: string; label: string };
  format?: (value: number) => string;
  /** Slices before folding the rest into Other. */
  max?: number;
  /** Keys drawn in the neutral colour (e.g. Rest of India, Other). */
  otherKeys?: string[];
  /** Fixed colours by key (e.g. gold and silver). */
  colors?: Record<string, string>;
}) {
  const positive = rows.filter((r) => r.value > 0);
  const total = positive.reduce((n, r) => n + r.value, 0);
  if (total <= 0) return <div className="muted" style={{ fontSize: 12.5 }}>Nothing to show.</div>;
  let slices = positive;
  if (positive.length > max) {
    const sorted = [...positive].sort((a, b) => b.value - a.value);
    const rest = sorted.slice(max - 1).reduce((n, r) => n + r.value, 0);
    slices = [...sorted.slice(0, max - 1), { key: "__other", label: "Other", value: rest }];
  }
  const R = 46;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let colorIndex = 0;
  const drawn = slices.map((s) => {
    const neutral = s.key === "__other" || otherKeys.includes(s.key);
    const color = colors[s.key] ?? (neutral ? DONUT_OTHER : DONUT_COLORS[colorIndex++ % DONUT_COLORS.length]!);
    const part = s.value / total;
    const seg = { ...s, color, part, dash: part * C, offset };
    offset += part * C;
    return seg;
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="Share chart">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--sunk)" strokeWidth="16" />
        {drawn.map((s) => (
          <circle
            key={s.key}
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={`${Math.max(s.dash - 0.8, 0.1)} ${C}`}
            strokeDashoffset={-s.offset}
            transform="rotate(-90 60 60)"
          >
            <title>{`${s.label}: ${(s.part * 100).toFixed(1)}% · ${format(s.value)}`}</title>
          </circle>
        ))}
        {center ? (
          <>
            <text x="60" y="58" textAnchor="middle" className="donut-v">{center.value}</text>
            <text x="60" y="73" textAnchor="middle" className="donut-l">{center.label}</text>
          </>
        ) : null}
      </svg>
      <ul className="donut-legend">
        {drawn.map((s) => (
          <li key={s.key} title={format(s.value)}>
            <i style={{ background: s.color }} />
            <span className="nm">{s.label}</span>
            <b>{(s.part * 100).toFixed(s.part < 0.1 ? 1 : 0)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical columns with a tone per column, e.g. stores per LFL band or per month. */
export function ToneColumns({
  rows,
  caption,
  format = (v) => String(v),
}: {
  rows: { key: string; label: string; value: number; tone?: "pos" | "neg" | "mid"; hint?: string }[];
  caption?: string;
  format?: (value: number) => string;
}) {
  const peak = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="tonecols">
      <div className="tc-grid">
        {rows.map((r) => (
          <div className="tc" key={r.key} title={r.hint ?? `${r.label}: ${r.value}`}>
            <span className="cnt">{format(r.value)}</span>
            <span className={`bar ${r.tone ?? "mid"}`} style={{ height: `${Math.max((r.value / peak) * 100, r.value ? 3 : 0)}%` }} />
            <span className="lab">{r.label}</span>
          </div>
        ))}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/** Two columns per period (e.g. joined in green, left in red), with a caption line per period. */
export function PairColumns({
  rows,
  labels,
}: {
  rows: { key: string; label: string; a: number; b: number; note?: string }[];
  labels: [string, string];
}) {
  const peak = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <figure className="paircols">
      <div className="pc-grid">
        {rows.map((r) => (
          <div className="pc" key={r.key} title={`${r.label}: ${labels[0]} ${r.a}, ${labels[1]} ${r.b}${r.note ? ` · ${r.note}` : ""}`}>
            <div className="pc-bars">
              <span className="bar pos" style={{ height: `${(r.a / peak) * 100}%` }}>
                <i>{r.a}</i>
              </span>
              <span className="bar neg" style={{ height: `${(r.b / peak) * 100}%` }}>
                <i>{r.b}</i>
              </span>
            </div>
            <span className="lab">{r.label}</span>
            {r.note ? <span className="note">{r.note}</span> : null}
          </div>
        ))}
      </div>
      <figcaption className="legend">
        <span>
          <i style={{ background: "var(--pos)" }} />
          {labels[0]}
        </span>
        <span>
          <i style={{ background: "var(--neg)" }} />
          {labels[1]}
        </span>
      </figcaption>
    </figure>
  );
}

/** About five round ticks across [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export type ScatterPoint = { id: string; name: string; x: number; y: number; highlight: boolean };

/**
 * Stores as dots: one factor across, revenue up. Highlighted stores (the city)
 * sit on top in the accent colour; the rest are context. A dashed least-squares
 * line shows the overall trend. Hover finds the nearest dot within 24px.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
  highlightLabel,
  otherLabel,
  onSelect,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  highlightLabel: string;
  otherLabel: string;
  onSelect?: (id: string) => void;
}) {
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 320;
  const pad = { l: 64, r: 18, t: 14, b: 42 };
  if (points.length < 2) return <div className="muted" style={{ fontSize: 12.5 }}>Not enough stores with this number to plot.</div>;

  const xsAll = points.map((p) => p.x);
  const [xMin, xMax] = [Math.min(...xsAll), Math.max(...xsAll)];
  const xTicks = niceTicks(xMin, xMax);
  const x0 = Math.min(xMin, xTicks[0]!);
  const x1 = Math.max(xMax, xTicks[xTicks.length - 1]!);
  const yTicks = niceTicks(0, Math.max(...points.map((p) => p.y)));
  const y1 = yTicks[yTicks.length - 1]! || 1;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / y1) * (H - pad.t - pad.b);

  // Least-squares trend over every dot.
  const n = points.length;
  const mx = xsAll.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const slope = sxx > 0 ? points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const at = (x: number) => Math.min(y1, Math.max(0, my + slope * (x - mx)));

  const ordered = [...points.filter((p) => !p.highlight), ...points.filter((p) => p.highlight)];
  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * H;
    const scale = W / box.width;
    let best: ScatterPoint | null = null;
    let bestD = 24 * scale;
    for (const p of ordered) {
      const d = Math.hypot(sx(p.x) - px, sy(p.y) - py);
      // Ties go to the highlighted dot, which is drawn on top.
      if (d < bestD || (d === bestD && p.highlight)) {
        best = p;
        bestD = d;
      }
    }
    setHover(best);
  };

  return (
    <figure className="scatter">
      <div className="legend" aria-hidden>
        <span><i className="sw sc-city" /> {highlightLabel}</span>
        <span><i className="sw sc-other" /> {otherLabel}</span>
        <span><i className="sw sc-trend" /> Trend</span>
      </div>
      <div className="scatter-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${yLabel} against ${xLabel}, one dot per store`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover && onSelect?.(hover.id)}
          style={{ cursor: hover && onSelect ? "pointer" : "default" }}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line className="sc-grid" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text className="sc-tick" x={pad.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} className="sc-tick" x={sx(t)} y={H - pad.b + 16} textAnchor="middle">
              {formatX(t)}
            </text>
          ))}
          <line className="sc-axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
          <text className="sc-label" x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle">
            {xLabel}
          </text>
          <line className="sc-trendline" x1={sx(x0)} y1={sy(at(x0))} x2={sx(x1)} y2={sy(at(x1))} />
          {ordered.map((p) => (
            <circle
              key={p.id}
              className={p.highlight ? "sc-dot sc-city" : "sc-dot sc-other"}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.highlight ? 5.5 : 4.5}
              data-active={hover?.id === p.id || undefined}
            />
          ))}
        </svg>
        {hover ? (
          <div className="tip" style={{ left: `${(sx(hover.x) / W) * 100}%`, top: `calc(${(sy(hover.y) / H) * 100}% - 10px)` }}>
            <strong>{hover.name}</strong>
            <br />
            {yLabel}: {formatY(hover.y)}
            <br />
            {xLabel}: {formatX(hover.x)}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
