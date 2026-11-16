import type { ColumnType } from "../../reports";

export { growth, growthOf, pts, ratio, ratioPair } from "../../reports";

export function inr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  return `${sign}₹${Math.round(abs)}`;
}

export const count = (value: number | null | undefined, digits = 0): string =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value * 100).toFixed(digits)}%`;
}

export const share = (value: number | null | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;

export function ptsText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value * 100).toFixed(1)} pts`;
}

export const tone = (value: number | null | undefined): "pos" | "neg" | "na" | "" =>
  value == null || !Number.isFinite(value) ? "na" : value > 0 ? "pos" : value < 0 ? "neg" : "";

export function tenure(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return "—";
  if (months < 12) return `${Math.round(months)} mo`;
  return `${(months / 12).toFixed(1)} yr`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-10-01 -> 1 Oct 2026. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

/** Text for any report cell (growth and pts get their own components on screen). */
export function formatValue(type: ColumnType, value: string | number | null): string {
  if (value == null) return "—";
  if (typeof value === "string") return type === "date" ? longDate(value) : value;
  switch (type) {
    case "inr":
      return inr(value);
    case "rupees":
      return `${value < 0 ? "−" : ""}₹${count(Math.abs(value))}`;
    case "int":
      return count(value);
    case "dec":
      return count(value, 1);
    case "growth":
      return pct(value);
    case "share":
      return share(value);
    case "pts":
      return ptsText(value);
    case "months":
      return tenure(value);
    default:
      return String(value);
  }
}
