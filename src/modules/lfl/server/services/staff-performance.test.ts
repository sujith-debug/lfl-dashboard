import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthsBetweenIso, rankCorrelation, staffLinker, tenureVsSales } from "./staff-performance";
import type { StaffRegisterRecord, StaffSaleMonthRecord } from "../models";

const person = (employeeNo: string, joinedOn: string, extra: Partial<StaffRegisterRecord> = {}): StaffRegisterRecord => ({
  month: "2026-08-01",
  employeeNo,
  name: `Person ${employeeNo}`,
  storeId: "s1",
  role: "Fashion consultant",
  joinedOn,
  leftOn: null,
  ...extra,
});
const sale = (staffId: string, sales: number, extra: Partial<StaffSaleMonthRecord> = {}): StaffSaleMonthRecord => ({
  month: "2026-08-01",
  storeId: "s1",
  staffId,
  name: null,
  sales,
  gold: 0,
  bills: Math.round(sales / 5000),
  units: 0,
  days: 20,
  ...extra,
});

describe("staff performance", () => {
  it("links POS sellers to the register by id, else by a unique name in the same store", () => {
    const link = staffLinker([person("GIVA-1", "2025-01-01"), { ...person("GIVA-2", "2025-01-01"), name: "Asha K" }]);
    assert.equal(link({ staffId: "giva-1", name: null, storeId: "s1" })?.employeeNo, "GIVA-1");
    assert.equal(link({ staffId: "GIVA-EBO9", name: "asha k", storeId: "s1" })?.employeeNo, "GIVA-2");
    assert.equal(link({ staffId: "GIVA-EBO9", name: "Asha K", storeId: "s2" }), null);
  });

  it("counts whole months of tenure", () => {
    assert.equal(monthsBetweenIso("2025-07-10", "2026-04-01"), 8);
    assert.equal(monthsBetweenIso("2026-04-01", "2026-04-01"), 0);
  });

  it("ranks perfectly related values at 1 and reversed at -1", () => {
    assert.equal(rankCorrelation([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(rankCorrelation([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  });

  it("compares consultants by tenure over full months, leaving out joining and leaving months", () => {
    const registers: StaffRegisterRecord[] = [];
    const sales: StaffSaleMonthRecord[] = [];
    for (let i = 0; i < 30; i++) {
      // Tenure 0-29 months at 1 Aug; sales rise with tenure.
      const joined = new Date(Date.UTC(2026, 7 - i, 1)).toISOString().slice(0, 10);
      registers.push(person(`E${i}`, joined));
      sales.push(sale(`E${i}`, 100_000 + i * 10_000));
    }
    // Joined mid-month and left mid-month: both left out.
    registers.push(person("NEW", "2026-08-15"), person("GONE", "2024-01-01", { leftOn: "2026-08-20" }));
    sales.push(sale("NEW", 1), sale("GONE", 1));
    // A store manager isn't a consultant.
    registers.push(person("SM", "2024-01-01", { role: "Store manager" }));
    sales.push(sale("SM", 5));

    const t = tenureVsSales(sales, registers, new Set(["s1"]), "2026-08-31")!;
    assert.equal(t.staffMonths, 30);
    assert.deepEqual(t.months, ["2026-08-01"]);
    assert.equal(t.correlation, 1);
    assert.equal(t.longerWinsShare, 1);
    assert.equal(t.bands.find((b) => b.key === "lt3")!.staffMonths, 3);
    // A range ending mid-September only uses August, the last full month.
    assert.ok(tenureVsSales(sales, registers, new Set(["s1"]), "2026-09-15"));
    assert.equal(tenureVsSales(sales, registers, new Set(["s1"]), "2026-08-30"), null);
  });
});
