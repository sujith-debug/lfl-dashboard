/**
 * Report definitions shared by the on-screen tables and the Excel / CSV
 * downloads, so a table and its export can never drift apart. Browser-safe.
 */

export type ColumnType =
  | "text"
  /** Rupees, compact (₹1.81 Cr, ₹20.8 K). */
  | "inr"
  /** Whole rupees (₹2,066), for per-unit prices like ASP where compact rounding hides the change. */
  | "rupees"
  | "int"
  | "dec"
  /** Growth as a ratio (0.12 = +12%), shown with ▲/▼. */
  | "growth"
  /** A share or rate between 0 and 1. */
  | "share"
  /** Difference of two shares, shown in percentage points. */
  | "pts"
  | "months"
  | "date";

export type CellValue = string | number | null;

export type ReportColumn<R> = {
  key: string;
  label: string;
  type: ColumnType;
  value: (row: R) => CellValue;
  /** Per-row type, for tables mixing units (e.g. a KPI summary). */
  typeOf?: (row: R) => ColumnType;
  /** Secondary line under the value, on screen only. */
  sub?: (row: R) => string | null;
  title?: string;
  /** Only in downloads (e.g. City when the screen shows it under the name). */
  exportOnly?: boolean;
  /** Only on screen. */
  screenOnly?: boolean;
};

export type ReportTable<R = unknown> = {
  key: string;
  title: string;
  /** Excel sheet name when the title is too long or repeats context. */
  sheet?: string;
  /** Short line for the sheet header and the card note. */
  description?: string;
  columns: ReportColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  total?: R;
};

/** Erases the row type so tables of different shapes can sit in one list. */
export type AnyReportTable = ReportTable<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const col = <R>(column: ReportColumn<R>): ReportColumn<R> => column;
