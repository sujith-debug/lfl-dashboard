import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { col, type ReportTable } from "../../reports";
import { categoryTable } from "../../reports/shared";
import { toCsv, toXlsx } from "./report-writer";

type Row = { name: string; sales: number; lfl: number | null; mix: number };

const table: ReportTable<Row> = {
  key: "test",
  title: "Stores: test",
  rows: [
    { name: "Pune, A", sales: 1234.6, lfl: 0.1234, mix: 0.012 },
    { name: 'Say "hi"', sales: 10, lfl: null, mix: -0.005 },
  ],
  rowKey: (r) => r.name,
  columns: [
    col<Row>({ key: "name", label: "Store", type: "text", value: (r) => r.name }),
    col<Row>({ key: "sales", label: "Sales", type: "inr", value: (r) => r.sales }),
    col<Row>({ key: "lfl", label: "LFL", type: "growth", value: (r) => r.lfl }),
    col<Row>({ key: "mix", label: "Δ Mix", type: "pts", value: (r) => r.mix }),
    col<Row>({ key: "hidden", label: "Screen only", type: "text", value: () => "x", screenOnly: true }),
  ],
};

describe("report writer", () => {
  it("writes CSV with plain numbers, unit labels and quoting", () => {
    const csv = toCsv(table);
    assert.ok(csv.startsWith("﻿"), "BOM so Excel reads ₹ and Δ");
    const lines = csv.slice(1).trimEnd().split("\r\n");
    assert.deepEqual(lines, [
      "Store,Sales,LFL (%),Δ Mix (pts)",
      '"Pune, A",1235,12.3,1.2',
      '"Say ""hi""",10,,-0.5',
    ]);
  });

  it("adds a total row when the report has one", () => {
    const cats = categoryTable(
      "categories",
      "Category",
      [{ key: "R", label: "Rings", sales: { ty: 200, ly: 100 }, units: { ty: 2, ly: 1 }, inventory: null }],
      false
    );
    const lines = toCsv(cats).trimEnd().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[2]!.startsWith("Total,200,100,100.0"));
  });

  it("writes an Excel workbook with a cover sheet and formatted numbers", async () => {
    const buffer = await toXlsx([table], "1 Oct to 18 Oct", { title: "Report", lines: [["Period", "Oct"]] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
    assert.deepEqual(
      workbook.worksheets.map((w) => w.name),
      ["About", "Stores test"]
    );
    const sheet = workbook.getWorksheet("Stores test")!;
    assert.equal(sheet.getCell("A4").value, "Store");
    assert.equal(sheet.getCell("B5").value, 1234.6);
    assert.equal(sheet.getCell("C5").numFmt, "+0.0%;-0.0%;0.0%");
    // Points are stored as points (1.2), not as a fraction.
    assert.ok(Math.abs((sheet.getCell("D5").value as number) - 1.2) < 1e-9);
    assert.equal(sheet.getCell("E4").value, null, "screen-only columns are left out");
  });
});
