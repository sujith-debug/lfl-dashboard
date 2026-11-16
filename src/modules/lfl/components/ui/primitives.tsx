"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { pct, ptsText, tone } from "./format";

/** Growth figure with ▲/▼ and colour, for tables. */
export function Growth({ value, points = false }: { value: number | null | undefined; points?: boolean }) {
  return <span className={`g ${tone(value)}`}>{points ? ptsText(value) : pct(value)}</span>;
}

/** Growth as a tinted pill, for KPI cards and headers. */
export function Badge({ value, points = false }: { value: number | null | undefined; points?: boolean }) {
  const t = tone(value);
  const arrow = t === "pos" ? "▲" : t === "neg" ? "▼" : "";
  return (
    <span className={`badge ${t === "na" ? "" : t}`}>
      {arrow ? <span style={{ fontSize: ".7em" }}>{arrow}</span> : null}
      {points ? ptsText(value) : pct(value)}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  note,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`}>
      <header className="card-h">
        <div className="titles">
          <h2>{title}</h2>
          {subtitle ? <span className="sub">{subtitle}</span> : null}
        </div>
        {actions ? <div className="row no-print">{actions}</div> : null}
      </header>
      {children}
      {note ? <div className="card-note">{note}</div> : null}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg${small ? " sm" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Button that opens a small menu; closes on outside click or Escape. */
export function Menu({
  label,
  icon,
  children,
  buttonClass = "btn sm",
  iconOnly = false,
  align = "right",
  trigger,
}: {
  label: string;
  icon?: IconName;
  /** Custom button content (e.g. initials); the label becomes the accessible name. */
  trigger?: ReactNode;
  children: (close: () => void) => ReactNode;
  buttonClass?: string;
  iconOnly?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className={`${buttonClass}${iconOnly ? " icon-only" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly || trigger ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? (
          <>
            {icon ? <Icon name={icon} /> : null}
            {iconOnly ? null : label}
          </>
        )}
      </button>
      {open ? (
        <div className="menu" role="menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function Skeleton({ height, width = "100%", radius }: { height: number; width?: number | string; radius?: number }) {
  return <div className="sk" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
