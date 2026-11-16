import "server-only";

import { Readable } from "node:stream";
import ExcelJS from "exceljs";

export type RawRow = Record<string, unknown>;

/** Unique header names: blanks become Column N, repeats get _2, _3 (Store Details has two "City"). */
function uniqueHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();
  return values.map((v, i) => {
    const base = String(v ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

/** Plain value from an Excel cell: dates as YYYY-MM-DD, formulas as their result, rich text as text. */
function cellValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if ("result" in v) return cellValue(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.error) return null;
  }
  return value;
}

async function* xlsxRowsLoaded(buffer: Buffer): AsyncGenerator<unknown[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return;
  for (let i = 1; i <= sheet.rowCount; i++) {
    yield (sheet.getRow(i).values as unknown[]).slice(1).map(cellValue);
  }
}

/**
 * Streams rows where possible (the SKU export can be a million rows). Some
 * writers produce zips the streaming reader rejects
 * ("invalid signature"); those are read whole instead.
 */
async function* xlsxRows(buffer: Buffer): AsyncGenerator<unknown[]> {
  let yielded = 0;
  try {
    for await (const values of xlsxRowsStreamed(buffer)) {
      yielded++;
      yield values;
    }
  } catch (error) {
    if (yielded > 0) throw error;
    yield* xlsxRowsLoaded(buffer);
  }
}

async function* xlsxRowsStreamed(buffer: Buffer): AsyncGenerator<unknown[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    // Styles carry the date formats; without them dates arrive as serial numbers.
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
  });
  for await (const sheet of reader) {
    for await (const row of sheet) {
      const values = (row.values as unknown[]).slice(1).map(cellValue);
      yield values;
    }
    break; // first sheet only
  }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
function* csvRows(text: string): Generator<string[]> {
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    yield row;
  }
}

/**
 * Rows of a CSV or XLSX file as objects keyed by header. The header is the
 * first row with at least two filled cells (some sheets start with a blank row).
 */
export async function* readTable(
  buffer: Buffer,
  filename: string,
  /** Rows above the header, e.g. a title like "Pay Register For The Month Aug 2026". */
  onPreamble?: (values: unknown[]) => void
): AsyncGenerator<RawRow> {
  const isXlsx = /\.xlsx$/i.test(filename) || buffer.subarray(0, 2).toString("latin1") === "PK";
  const source: AsyncIterable<unknown[]> | Iterable<unknown[]> = isXlsx
    ? xlsxRows(buffer)
    : csvRows(buffer.toString("utf8").replace(/^﻿/, ""));

  let headers: string[] | null = null;
  for await (const values of source as AsyncIterable<unknown[]>) {
    if (!headers) {
      if (values.filter((v) => v != null && String(v).trim() !== "").length >= 2) {
        headers = uniqueHeaders(values);
      } else {
        onPreamble?.(values);
      }
      continue;
    }
    if (values.every((v) => v == null || String(v).trim() === "")) continue;
    const row: RawRow = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? null;
    });
    yield row;
  }
  if (!headers) {
    throw new Error("No header row found in the file");
  }
}
