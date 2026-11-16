import "server-only";

import ExcelJS from "exceljs";
import type { AnyReportTable, CellValue, ColumnType, ReportColumn } from "../../reports";

/** Columns that belong in a download (everything not marked screen-only). */
const exportColumns = (table: AnyReportTable) =>
  (table.columns as ReportColumn<unknown>[]).filter((c) => !c.screenOnly);

const PERCENT_TYPES = new Set<ColumnType>(["growth", "share"]);

/** Plain values for CSV: rupees and counts as numbers, percentages as 12.3. */
function csvValue(type: ColumnType, value: CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "";
  if (PERCENT_TYPES.has(type) || type === "pts") return (value * 100).toFixed(1);
  if (type === "inr" || type === "rupees" || type === "int") return String(Math.round(value));
  return value.toFixed(1);
}

function csvLabel(column: ReportColumn<unknown>): string {
  if (PERCENT_TYPES.has(column.type)) return `${column.label} (%)`;
  if (column.type === "pts") return `${column.label} (pts)`;
  if (column.type === "months") return `${column.label} (months)`;
  return column.label;
}

const csvCell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function toCsv(table: AnyReportTable): string {
  const columns = exportColumns(table);
  const rows = table.total ? [...table.rows, table.total] : table.rows;
  const lines = [columns.map((c) => csvCell(csvLabel(c))).join(",")];
  for (const row of rows) {
    lines.push(
      columns.map((c) => csvCell(csvValue(c.typeOf?.(row) ?? c.type, c.value(row)))).join(",")
    );
  }
  // BOM so Excel opens the ₹ / Δ characters correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

const NUM_FMT: Partial<Record<ColumnType, string>> = {
  inr: '"₹"#,##,##0',
  rupees: '"₹"#,##,##0',
  int: "#,##,##0",
  dec: "#,##0.0",
  growth: '+0.0%;-0.0%;0.0%',
  share: "0.0%",
  pts: '+0.0" pts";-0.0" pts";0.0" pts"',
  months: '0.0" mo"',
};

const BRAND = { rose: "FFBC4263", blush: "FFFDE3E9", sunk: "FFFBEEEB", ink: "FF121212", muted: "FF8D8285" };

/** Sheet names: 31 chars max, no []:*?/\ characters, unique within a workbook. */
function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    name = `${base.slice(0, 28)} ${i}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function addSheet(workbook: ExcelJS.Workbook, table: AnyReportTable, context: string, used: Set<string>) {
  const sheet = workbook.addWorksheet(sheetName(table.sheet ?? table.title, used), {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  const columns = exportColumns(table);

  sheet.getCell("A1").value = table.title;
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: BRAND.ink } };
  sheet.getCell("A2").value = table.description ? `${context} · ${table.description}` : context;
  sheet.getCell("A2").font = { size: 10, color: { argb: BRAND.muted } };

  const header = sheet.getRow(4);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.rose } };
    cell.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
  });
  header.height = 20;

  const write = (row: unknown, index: number, isTotal: boolean) => {
    const excelRow = sheet.getRow(5 + index);
    columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const type = c.typeOf?.(row) ?? c.type;
      const value = c.value(row);
      if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
        cell.value = null;
      } else if (type === "pts" && typeof value === "number") {
        cell.value = value * 100;
      } else {
        cell.value = value;
      }
      const fmt = NUM_FMT[type];
      if (fmt) cell.numFmt = fmt;
      cell.alignment = { horizontal: i === 0 || type === "text" ? "left" : "right" };
      if (isTotal) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.sunk } };
      }
    });
  };
  table.rows.forEach((row, i) => write(row, i, false));
  if (table.total) write(table.total, table.rows.length, true);

  columns.forEach((c, i) => {
    const values = table.rows.map((r) => String(c.value(r) ?? ""));
    const widest = Math.max(c.label.length, ...values.map((v) => v.length));
    sheet.getColumn(i + 1).width = Math.min(42, Math.max(10, widest + 3));
  });
  if (table.rows.length > 0) {
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  }
}

export async function toXlsx(
  tables: AnyReportTable[],
  context: string,
  cover?: { title: string; lines: [string, string][] }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GIVA Store LFL Board";
  workbook.created = new Date();
  const used = new Set<string>();

  if (cover) {
    const sheet = workbook.addWorksheet(sheetName("About", used));
    sheet.getCell("A1").value = cover.title;
    sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: BRAND.rose } };
    cover.lines.forEach(([label, value], i) => {
      sheet.getCell(`A${3 + i}`).value = label;
      sheet.getCell(`A${3 + i}`).font = { bold: true };
      sheet.getCell(`B${3 + i}`).value = value;
    });
    sheet.getColumn(1).width = 22;
    sheet.getColumn(2).width = 80;
  }
  for (const table of tables) {
    addSheet(workbook, table, context, used);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
