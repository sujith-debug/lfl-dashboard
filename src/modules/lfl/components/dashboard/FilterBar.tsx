"use client";

import { SQFT_BANDS, type LflDashboardDto, type LflFilters } from "../../contracts";
import { festivalCompare, FESTIVALS } from "../festivals";
import { quickRange, QUICK_RANGES } from "../ranges";
import { Icon } from "../ui/Icon";

type Props = {
  /** Collapsed: one line with the active filters and a button to open the panel. */
  open: boolean;
  onToggle: () => void;
  filters: LflFilters;
  options: LflDashboardDto["options"] | null;
  today: string;
  storeCount: number | null;
  onChange: (patch: Partial<LflFilters>) => void;
  onReset: () => void;
};

const STORE_FILTERS = [
  { key: "region", label: "Region", all: "All regions" },
  { key: "subregion", label: "Sub-region", all: "All sub-regions" },
  { key: "city", label: "City", all: "All cities" },
  { key: "am", label: "AM / CM", all: "All AMs" },
  { key: "age", label: "Store age", all: "All ages" },
  { key: "type", label: "Store type", all: "All types" },
] as const;

/** Back to comparing with the same dates a year earlier. */
const PLAIN_DATES: Partial<LflFilters> = { festival: undefined, lyFrom: undefined, lyTo: undefined };

/** Same calendar date a year earlier; 29 Feb becomes 28 Feb. */
const yearEarlier = (date: string) => {
  const [y, m, d] = date.split("-");
  return m === "02" && d === "29" ? `${Number(y) - 1}-02-28` : `${Number(y) - 1}-${m}-${d}`;
};
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function FilterBar({ open, onToggle, filters, options, today, storeCount, onChange, onReset }: Props) {
  const compareMode = filters.festival ? filters.festival : filters.lyFrom ? "custom" : "";
  // A festival fixes both windows; changing this year's dates leaves it. Custom comparison dates stay put.
  const datePatch = (patch: Partial<LflFilters>) => onChange(filters.festival ? { ...PLAIN_DATES, ...patch } : patch);
  const festivals = FESTIVALS.map((f) => ({ key: f.key, label: f.label, compare: festivalCompare(f.key, today) })).filter((f) => f.compare);
  const activeQuick = filters.festival ? undefined : QUICK_RANGES.find((q) => {
    const range = quickRange(q.key, today);
    return range.from === filters.from && range.to === filters.to;
  })?.key;

  const optionsFor = (key: (typeof STORE_FILTERS)[number]["key"]) =>
    ({ region: options?.regions, subregion: options?.subregions, city: options?.cities, am: options?.ams, age: options?.ages, type: options?.types })[key] ?? [];

  const applied: { key: string; label: string; clear: Partial<LflFilters> }[] = [];
  for (const f of STORE_FILTERS) {
    const value = filters[f.key];
    if (value) applied.push({ key: f.key, label: `${f.label}: ${value}`, clear: { [f.key]: undefined } });
  }
  if (filters.sqft) {
    applied.push({
      key: "sqft",
      label: SQFT_BANDS.find((b) => b.key === filters.sqft)?.label ?? filters.sqft,
      clear: { sqft: undefined },
    });
  }
  if (!filters.lflOnly) applied.push({ key: "lfl", label: "Including new stores", clear: { lflOnly: true } });
  if (filters.excludeClosed) applied.push({ key: "closed", label: "Closed stores excluded", clear: { excludeClosed: false } });
  const compareChip =
    compareMode === "custom"
      ? "Custom comparison"
      : compareMode
        ? `vs last year's ${festivals.find((f) => f.key === compareMode)?.label.replace(/ \(.*\)$/, "") ?? "festival"}`
        : null;

  // Last year's window as shown: the custom / festival dates, or the same dates a year earlier.
  const lyFrom = filters.lyFrom ?? yearEarlier(filters.from);
  const lyTo = filters.lyTo ?? yearEarlier(filters.to);
  const thisYearDates = (
    <div className="dates">
      <input
        aria-label="This year from"
        type="date"
        value={filters.from}
        max={filters.to}
        onChange={(e) => e.target.value && datePatch({ from: e.target.value })}
      />
      <span className="dash">–</span>
      <input
        aria-label="This year to"
        type="date"
        value={filters.to}
        min={filters.from}
        max={today}
        onChange={(e) => e.target.value && datePatch({ to: e.target.value })}
      />
    </div>
  );
  // Editing last year's dates makes it a custom comparison.
  const lastYearDates = (
    <div className="dates">
      <input
        aria-label="Last year from"
        type="date"
        value={lyFrom}
        max={lyTo}
        onChange={(e) => e.target.value && onChange({ festival: undefined, lyFrom: e.target.value, lyTo })}
      />
      <span className="dash">–</span>
      <input
        aria-label="Last year to"
        type="date"
        value={lyTo}
        min={lyFrom}
        max={dayBefore(filters.from)}
        onChange={(e) => e.target.value && onChange({ festival: undefined, lyFrom, lyTo: e.target.value })}
      />
    </div>
  );

  if (!open) {
    return (
      <section className="filterbar collapsed" aria-label="Filters">
        <button className="btn sm" type="button" onClick={onToggle} aria-expanded={false}>
          <Icon name="filter" /> Filters{applied.length ? ` · ${applied.length}` : ""}
        </button>
        <div className="period">
          <span className="period-label">This year</span>
          {thisYearDates}
        </div>
        <span className="period-vs">vs</span>
        <div className="period">
          <span className="period-label">Last year</span>
          {lastYearDates}
        </div>
        {compareChip ? (
          <button type="button" className="chip applied" onClick={() => onChange(PLAIN_DATES)} title="Compare with the same dates last year">
            {compareChip} <Icon name="x" />
          </button>
        ) : null}
        {applied.map((a) => (
          <button key={a.key} type="button" className="chip applied" onClick={() => onChange(a.clear)} title="Remove filter">
            {a.label} <Icon name="x" />
          </button>
        ))}
        <span className="muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
          {storeCount != null ? `${storeCount} store${storeCount === 1 ? "" : "s"} in view` : "Loading stores…"}
        </span>
      </section>
    );
  }

  return (
    <section className="filterbar" aria-label="Filters">
      <div className="filterbar-head">
        <span className="muted">Filters</span>
        <button className="btn sm" type="button" onClick={onToggle} aria-expanded>
          Hide filters
        </button>
      </div>
      <div className="filters">
        <div className="field">
          <span>This year</span>
          {thisYearDates}
        </div>
        <div className="field">
          <span>Quick range</span>
          <div className="chips" style={{ height: 36 }}>
            {QUICK_RANGES.map((q) => (
              <button
                key={q.key}
                className="chip"
                type="button"
                aria-pressed={activeQuick === q.key}
                onClick={() => onChange({ ...PLAIN_DATES, ...quickRange(q.key, today) })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field festival-field">
          <span>Compare with</span>
          <select
            value={compareMode}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "") return onChange(PLAIN_DATES);
              if (value === "custom") return onChange({ festival: undefined, lyFrom: yearEarlier(filters.from), lyTo: yearEarlier(filters.to) });
              const c = festivals.find((f) => f.key === value)?.compare;
              if (c) onChange({ festival: c.key, from: c.from, to: c.to, lyFrom: c.lyFrom, lyTo: c.lyTo });
            }}
          >
            <option value="">Same dates last year</option>
            <option value="custom">Custom dates…</option>
            <optgroup label="Festival vs last year's festival">
              {festivals.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} · {f.compare!.from.slice(0, 4)} vs {f.compare!.lyFrom.slice(0, 4)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="field">
          <span>Last year</span>
          {lastYearDates}
        </div>
        {STORE_FILTERS.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <select value={filters[f.key] ?? ""} onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}>
              <option value="">{f.all}</option>
              {optionsFor(f.key).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="field">
          <span>Carpet area</span>
          <select
            value={filters.sqft ?? ""}
            onChange={(e) => onChange({ sqft: (e.target.value || undefined) as LflFilters["sqft"] })}
          >
            <option value="">All sizes</option>
            {SQFT_BANDS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="switch" title="Stores whose first sale was more than a year before the start date (the LFL Metrics Main #8734 rule)">
          <input type="checkbox" checked={filters.lflOnly} onChange={(e) => onChange({ lflOnly: e.target.checked })} />
          <span className="track" />
          LFL stores only
        </label>
        <label className="switch" title="Leave out stores the store master marks Closed, from this year and last year. Off by default: LFL Metrics Main (#8734) keeps their last-year sales.">
          <input type="checkbox" checked={filters.excludeClosed} onChange={(e) => onChange({ excludeClosed: e.target.checked })} />
          <span className="track" />
          Exclude closed stores
        </label>
      </div>
      <div className="chips">
        <span className="muted" style={{ fontSize: 12.5, marginRight: 4 }}>
          {storeCount != null ? `${storeCount} store${storeCount === 1 ? "" : "s"} in view` : "Loading stores…"}
        </span>
        {applied.map((a) => (
          <button key={a.key} type="button" className="chip applied" onClick={() => onChange(a.clear)} title="Remove filter">
            {a.label} <Icon name="x" />
          </button>
        ))}
        {applied.length ? (
          <button type="button" className="linkbtn" onClick={onReset}>
            Clear all
          </button>
        ) : null}
      </div>
    </section>
  );
}
