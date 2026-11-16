import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeSnapshotDays,
  mapStaff,
  matchBranch,
  registerMonth,
  STAFF_FIELDS,
  DAILY_FIELDS,
  mapDaily,
  mapInventory,
  mapStore,
  resolveColumns,
  skuCategory,
  skuMetal,
  STORE_FIELDS,
  INVENTORY_FIELDS,
  toIsoDate,
  toNumber,
} from "./datasets";
import { readTable } from "./table-reader";

describe("feed parsing", () => {
  it("reads the date forms BigQuery exports and Excel produce", () => {
    assert.equal(toIsoDate("01-Apr", 2026), "2026-04-01");
    assert.equal(toIsoDate("15-Sep", "2026.0"), "2026-09-15");
    assert.equal(toIsoDate("2026-04-24 00:00:00"), "2026-04-24");
    assert.equal(toIsoDate("20260819"), "2026-08-19");
    assert.equal(toIsoDate("05/09/2026"), "2026-09-05");
    assert.equal(toIsoDate(46136), "2026-04-24", "Excel serial day");
    assert.equal(toIsoDate("W14", 2026), null, "weeks are not days");
    assert.equal(toIsoDate("2026-02-31"), null, "impossible day");
  });

  it("parses numbers with commas, rupee signs and percent", () => {
    assert.equal(toNumber("1,23,456.5"), 123456.5);
    assert.equal(toNumber("₹ 900"), 900);
    assert.equal(toNumber("-28.83%"), -28.83);
    assert.equal(toNumber(""), 0);
  });

  it("matches headers ignoring case and punctuation, and names what's missing", () => {
    const { columns, missing } = resolveColumns(["Store Name", "am_cm", "LIVE DATE"], STORE_FIELDS);
    assert.equal(columns.name, "Store Name");
    assert.equal(columns.am, "am_cm");
    assert.equal(columns.liveDate, "LIVE DATE");
    assert.deepEqual(missing, []);
    assert.deepEqual(resolveColumns(["foo"], DAILY_FIELDS).missing, ["period", "store", "tySales", "lySales"]);
  });

  it("maps an LFL export row, keyed by normalised store name", () => {
    const headers = ["D_W_M_Q", "Year", "location_name", "TY_Net_sales_after_ERDP", "LY_Net_sales_after_ERDP", "TY_G_sales_after_ERDP", "LY_G_sales_after_ERDP", "TY_NOB", "TY_FF"];
    const { columns } = resolveColumns(headers, DAILY_FIELDS);
    const row = mapDaily(
      { D_W_M_Q: "02-Apr", Year: 2026, location_name: "Crowns Interiorz mall", TY_Net_sales_after_ERDP: "17186.0", LY_Net_sales_after_ERDP: 4409, TY_G_sales_after_ERDP: 0, LY_G_sales_after_ERDP: 2550, TY_NOB: 3, TY_FF: 4 },
      columns
    )!;
    assert.equal(row.date, "2026-04-02");
    assert.equal(row.storeKey, "crownsinteriorzmall");
    assert.equal(row.tySales, 17186);
    // No silver column: silver is what isn't gold.
    assert.equal(row.lySilver, 4409 - 2550);
    assert.equal(row.tyFootfall, 4);
    // An older export without silver bills or units loads them as 0.
    assert.equal(row.tySilverBills, 0);
    assert.equal(row.tyGoldUnits, 0);
  });

  it("maps silver bills, units and line sales from the daily feed", () => {
    const headers = ["D_W_M_Q", "location_name", "TY_Net_sales_after_ERDP", "LY_Net_sales_after_ERDP", "TY_S_NOB", "LY_S_NOB", "TY_G_qty", "LY_S_qty", "TY_G_line_sales", "LY_S_line_sales"];
    const { columns } = resolveColumns(headers, DAILY_FIELDS);
    const row = mapDaily(
      { D_W_M_Q: "2026-09-01", location_name: "Garuda Mall", TY_Net_sales_after_ERDP: 1000, LY_Net_sales_after_ERDP: 900, TY_S_NOB: 12, LY_S_NOB: 9, TY_G_qty: 3, LY_S_qty: 20, TY_G_line_sales: 66000, LY_S_line_sales: 41000 },
      columns
    )!;
    assert.deepEqual(
      [row.tySilverBills, row.lySilverBills, row.tyGoldUnits, row.lySilverUnits, row.tyGoldLineSales, row.lySilverLineSales],
      [12, 9, 3, 20, 66000, 41000]
    );
  });

  it("maps a store details row and tidies its fields", () => {
    const { columns } = resolveColumns(["Store Name", "Type", "Live status", "Live Date", "Store Id"], STORE_FIELDS);
    const row = mapStore({ "Store Name": "1 MG Mall", Type: "Mall", "Live status": "closed", "Live Date": "2022-05-05", "Store Id": "#VALUE!" }, columns)!;
    assert.equal(row.key, "1mgmall");
    assert.equal(row.storeType, "Mall");
    assert.equal(row.status, "Closed");
    assert.equal(row.liveDate, "2022-05-05");
    assert.equal(row.locationId, null);
  });

  it("derives metal and category from GIVA SKUs", () => {
    assert.equal(skuMetal("GDR0012"), "GOLD");
    assert.equal(skuCategory("GDR0012"), "R");
    assert.equal(skuMetal("PD0451"), "SILVER");
    assert.equal(skuCategory("PD0451"), "PD");
    const { columns } = resolveColumns(["date", "store_name", "sku", "quantity"], INVENTORY_FIELDS);
    assert.deepEqual(mapInventory({ date: "2026-04-24", store_name: "1 MG Mall", sku: "ER0009", quantity: 2 }, columns), {
      date: "2026-04-24",
      storeKey: "1mgmall",
      metal: "SILVER",
      category: "ER",
      units: 2,
    });
  });

  it("leaves out stock days that cover far fewer stores", () => {
    const days = new Map([
      ["2026-04-24", new Set(["a", "b", "c", "d", "e"])],
      ["2026-04-25", new Set(["a", "b", "c", "d", "e"])],
      ["2026-04-26", new Set(["a", "b"])],
    ]);
    assert.deepEqual([...completeSnapshotDays(days)].sort(), ["2026-04-24", "2026-04-25"]);
  });

  it("reads CSV with a BOM, quoted commas and doubled quotes", async () => {
    const csv = '﻿Store Name,Carpet Area\r\n"Pune, Camp",450\r\n"Say ""hi""",300\r\n';
    const rows = [];
    for await (const row of readTable(Buffer.from(csv), "x.csv")) rows.push(row);
    assert.deepEqual(rows, [
      { "Store Name": "Pune, Camp", "Carpet Area": "450" },
      { "Store Name": 'Say "hi"', "Carpet Area": "300" },
    ]);
  });
});

describe("staff registers", () => {
  it("reads the month from the title row or the file name", () => {
    assert.equal(registerMonth("Pay Register For The Month Aug 2026"), "2026-08-01");
    assert.equal(registerMonth(null, "EBO Store Staff  - Sep 2026.xlsx"), "2026-09-01");
    assert.equal(registerMonth("Staff list"), null);
  });

  it("maps a register row and skips other departments", () => {
    const columns = resolveColumns(
      ["Sl No", "EmployeeNo", "Name", "Join Date", "Leaving Date", "Division", "Department", "Designation", "Branch", "Location", "State"],
      STAFF_FIELDS
    ).columns;
    const row = { EmployeeNo: "GIVA-1", Name: "Asha", "Join Date": "10 Jul 2025", "Leaving Date": null, Department: "EBO Store", Designation: "Store manager", Branch: "Mall of Faridabad  NIT", Location: "Faridabad" };
    assert.deepEqual(mapStaff(row, columns), {
      employeeNo: "GIVA-1",
      name: "Asha",
      designation: "Store manager",
      branch: "Mall of Faridabad NIT",
      city: "Faridabad",
      joinDate: "2025-07-10",
      leaveDate: null,
    });
    assert.equal(mapStaff({ ...row, Department: "Warehouse" }, columns), null);
  });

  it("links HR branches to stores by name within the city, and never across store numbers", () => {
    const stores = [
      { key: "kukatpallyhs", name: "Kukatpally HS", city: "Hyderabad" },
      { key: "sector104hs", name: "SECTOR 104 HS", city: "Delhi NCR" },
      { key: "sector31gurugramhs", name: "Sector 31 Gurugram HS", city: "Delhi NCR" },
      { key: "jayanagar2hs", name: "Jayanagar 2 HS", city: "Bengaluru" },
      { key: "ringroadahemdabad", name: "Ring Road Ahemdabad", city: "Ahmedabad" },
      { key: "cgroadahmedabad", name: "CG Road Ahmedabad", city: "Ahmedabad" },
    ];
    assert.equal(matchBranch("Kukatpally HS", "Hyderabad", stores).method, "exact");
    assert.equal(matchBranch("Kukkatpally HS", "Hyderabad", stores).storeKey, "kukatpallyhs");
    assert.equal(matchBranch("Kukkatpally HS", "Pune", stores).storeKey, null);
    assert.equal(matchBranch("Sector 31", "Gurugram", stores).storeKey, "sector31gurugramhs");
    assert.equal(matchBranch("Sector 14", "Gurugram", stores).storeKey, null);
    assert.equal(matchBranch("Jayanagar 1 HS", "Bengaluru", stores).storeKey, null);
    assert.notEqual(matchBranch("Ring Road, Ahmedabad", "Ahmedabad", stores).storeKey, "cgroadahmedabad");
  });
});
