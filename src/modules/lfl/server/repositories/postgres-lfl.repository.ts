import "server-only";

import { instrumentObject } from "@foundry/logger";
import { prisma } from "@/lib/db/prisma";
import type {
  InventoryRecord,
  PeriodRanges,
  SegmentRecord,
  StaffMonthRecord,
  StaffRecord,
  StaffRegisterRecord,
  StaffSaleMonthRecord,
  StaffSaleRecord,
  StoreDayRecord,
  StoreRecord,
} from "../models";
import { addDays, isCustomLy, shiftYears } from "../services/lfl.dates";

/** A stock count older than this before the as-of date is treated as missing, not shown as current. */
const MAX_SNAPSHOT_AGE_DAYS = 3;
import type { LflRepository } from "./lfl.repository";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "hyderabad" / "HYDERABAD" -> "Hyderabad"; mixed-case names (e.g. "Delhi NCR") are kept. */
export function tidyCity(city: string): string {
  const trimmed = city.trim().replace(/\s+/g, " ");
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/**
 * Reads the BigQuery feeds stored in the app database (see server/ingest).
 * Each daily row holds this year's numbers for its date and last year's for
 * the same calendar day, so LY records are re-dated one year back.
 */
class PostgresLflRepository implements LflRepository {
  readonly source = "bigquery" as const;

  async listStores(): Promise<StoreRecord[]> {
    const [master, latest, firstLy] = await Promise.all([
      prisma.lflStore.findMany(),
      // The newest daily row per store carries the current region / AM / city.
      prisma.$queryRaw<{ storeKey: string; storeName: string; region: string | null; am: string | null; city: string | null }[]>`
        SELECT DISTINCT ON ("storeKey") "storeKey", "storeName", region, am, city
        FROM lfl_store_days
        ORDER BY "storeKey", date DESC`,
      prisma.$queryRaw<{ storeKey: string; first: Date }[]>`
        SELECT "storeKey", MIN(date) AS first FROM lfl_store_days WHERE "lySales" > 0 GROUP BY "storeKey"`,
    ]);
    const byKey = new Map(master.map((m) => [m.key, m]));
    const lyStart = new Map(firstLy.map((r) => [r.storeKey, iso(r.first)]));
    const keys = new Set([...latest.map((l) => l.storeKey), ...master.filter((m) => m.status !== "Closed").map((m) => m.key)]);

    const latestByKey = new Map(latest.map((l) => [l.storeKey, l]));
    return [...keys].map((key) => {
      const m = byKey.get(key);
      const l = latestByKey.get(key);
      // Opening date: first order (as in LFL Metrics Main #8734), else Live Date,
      // else a year before the first day with last-year sales.
      const firstLyDay = lyStart.get(key);
      return {
        id: key,
        name: m?.name ?? l?.storeName ?? key,
        region: l?.region ?? m?.region ?? "Unassigned",
        subregion: m?.subregion ?? null,
        status: m?.status ?? null,
        lastSaleOn: m?.lastSaleDate ? iso(m.lastSaleDate) : null,
        city: tidyCity(l?.city ?? m?.city ?? "Unknown"),
        am: l?.am ?? m?.am ?? "Unassigned",
        firstSaleOn: m?.firstOrderDate
          ? iso(m.firstOrderDate)
          : m?.liveDate
            ? iso(m.liveDate)
            : firstLyDay
              ? shiftYears(firstLyDay, -1)
              : null,
        type: m?.storeType ?? null,
        lat: m?.latitude ?? null,
        lng: m?.longitude ?? null,
        sqft: null,
      };
    });
  }

  /**
   * Each stored row holds a day's numbers and the same day 365 days earlier.
   * For a custom comparison (a festival) the comparison window's own rows are
   * read and their this-year numbers become LY.
   */
  async storeDays(ranges: PeriodRanges): Promise<StoreDayRecord[]> {
    const custom = isCustomLy(ranges);
    const [main, comparison] = await Promise.all([
      prisma.lflStoreDay.findMany({ where: { date: { gte: day(ranges.from), lte: day(ranges.to) } } }),
      custom ? prisma.lflStoreDay.findMany({ where: { date: { gte: day(ranges.lyFrom), lte: day(ranges.lyTo) } } }) : Promise.resolve([]),
    ]);
    type Row = (typeof main)[number];
    const tyOf = (r: Row, period: "TY" | "LY"): StoreDayRecord => ({
      storeId: r.storeKey,
      period,
      date: iso(r.date),
      sales: r.tySales,
      gold: r.tyGold,
      silver: r.tySilver,
      bills: r.tyBills,
      goldBills: r.tyGoldBills,
      footfall: r.tyFootfall,
      silverBills: r.tySilverBills,
      goldUnits: r.tyGoldUnits,
      silverUnits: r.tySilverUnits,
      goldLineSales: r.tyGoldLineSales,
      silverLineSales: r.tySilverLineSales,
      goldMtoSales: r.tyGoldMtoSales,
      goldMtoBills: r.tyGoldMtoBills,
      goldMtoUnits: r.tyGoldMtoUnits,
      goldMtoLineSales: r.tyGoldMtoLineSales,
    });
    const out: StoreDayRecord[] = [];
    for (const r of main) {
      out.push(tyOf(r, "TY"));
      if (custom) continue;
      out.push({
        storeId: r.storeKey,
        period: "LY",
        date: shiftYears(iso(r.date), -1),
        sales: r.lySales,
        gold: r.lyGold,
        silver: r.lySilver,
        bills: r.lyBills,
        goldBills: r.lyGoldBills,
        footfall: r.lyFootfall,
        silverBills: r.lySilverBills,
        goldUnits: r.lyGoldUnits,
        silverUnits: r.lySilverUnits,
        goldLineSales: r.lyGoldLineSales,
        silverLineSales: r.lySilverLineSales,
        goldMtoSales: r.lyGoldMtoSales,
        goldMtoBills: r.lyGoldMtoBills,
        goldMtoUnits: r.lyGoldMtoUnits,
        goldMtoLineSales: r.lyGoldMtoLineSales,
      });
    }
    for (const r of comparison) out.push(tyOf(r, "LY"));
    return out;
  }

  /** Karat / classic / category split; null until the segment feed has data. */
  async segments(ranges: PeriodRanges): Promise<SegmentRecord[] | null> {
    const sums = (from: string, to: string) =>
      prisma.lflSegmentDay.groupBy({
        by: ["storeKey", "metal", "segment", "category"],
        where: { date: { gte: day(from), lte: day(to) } },
        _sum: { tySales: true, lySales: true, tyUnits: true, lyUnits: true },
      });
    const custom = isCustomLy(ranges);
    const [rows, comparison] = await Promise.all([sums(ranges.from, ranges.to), custom ? sums(ranges.lyFrom, ranges.lyTo) : Promise.resolve([])]);
    if (rows.length === 0 && comparison.length === 0) {
      return (await prisma.lflSegmentDay.count()) > 0 ? [] : null;
    }
    const out: SegmentRecord[] = [];
    const baseOf = (r: (typeof rows)[number]) => ({ storeId: r.storeKey, metal: r.metal as "GOLD" | "SILVER", segment: r.segment, category: r.category });
    for (const r of rows) {
      out.push({ ...baseOf(r), period: "TY", sales: r._sum.tySales ?? 0, units: r._sum.tyUnits ?? 0 });
      if (!custom) out.push({ ...baseOf(r), period: "LY", sales: r._sum.lySales ?? 0, units: r._sum.lyUnits ?? 0 });
    }
    for (const r of comparison) out.push({ ...baseOf(r), period: "LY", sales: r._sum.tySales ?? 0, units: r._sum.tyUnits ?? 0 });
    return out;
  }

  async inventory(asOf: { ty: string; ly: string }): Promise<InventoryRecord[] | null> {
    const snapshotOn = async (date: string) =>
      (await prisma.lflInventory.findFirst({
        where: { snapshotDate: { lte: day(date), gte: day(addDays(date, -MAX_SNAPSHOT_AGE_DAYS)) } },
        orderBy: { snapshotDate: "desc" },
        select: { snapshotDate: true },
      }))?.snapshotDate ?? null;
    const [ty, ly] = await Promise.all([snapshotOn(asOf.ty), snapshotOn(asOf.ly)]);
    if (!ty) {
      return (await prisma.lflInventory.count()) > 0 ? [] : null;
    }
    const read = async (snapshotDate: Date, period: "TY" | "LY") =>
      (await prisma.lflInventory.findMany({ where: { snapshotDate } })).map((r) => ({
        storeId: r.storeKey,
        period,
        snapshotDate: iso(snapshotDate),
        metal: r.metal as "GOLD" | "SILVER",
        category: r.category,
        units: r.units,
      }));
    return [...(await read(ty, "TY")), ...(ly ? await read(ly, "LY") : [])];
  }

  /**
   * Staff from the HR register for the as-of month (or the latest one before
   * it), placed in stores through the branch links. Active = joined on or
   * before the date and not left by then. Branches without a store are left out.
   */
  async staff(asOf: string): Promise<StaffRecord[] | null> {
    const register = await prisma.lflStaffMonth.findFirst({
      where: { month: { lte: day(`${asOf.slice(0, 7)}-01`) } },
      orderBy: { month: "desc" },
      select: { month: true },
    });
    if (!register) {
      return (await prisma.lflStaffMonth.count()) > 0 ? [] : null;
    }
    const [rows, links] = await Promise.all([
      prisma.lflStaffMonth.findMany({ where: { month: register.month } }),
      prisma.lflBranchMap.findMany({ where: { storeKey: { not: null } } }),
    ]);
    const storeOf = new Map(links.map((l) => [l.branch, l.storeKey!]));
    const out: StaffRecord[] = [];
    for (const r of rows) {
      const storeId = storeOf.get(r.branch);
      if (!storeId) continue;
      const startedOn = iso(r.joinDate);
      const leftOn = r.leaveDate ? iso(r.leaveDate) : null;
      out.push({
        staffId: r.employeeNo,
        name: r.name,
        storeId,
        startedOn,
        active: startedOn <= asOf && (!leftOn || leftOn > asOf),
        role: r.designation,
        leftOn,
      });
    }
    return out;
  }

  async staffSales(range: { from: string; to: string }): Promise<StaffSaleRecord[] | null> {
    if ((await prisma.lflStaffSale.count({ take: 1 })) === 0) return null;
    const rows = await prisma.$queryRaw<
      { storeKey: string; staffId: string; name: string | null; sales: number; gold: number; bills: bigint; units: number; days: bigint }[]
    >`SELECT "storeKey", "staffId", MAX("staffName") AS name, SUM(sales) AS sales, SUM(gold) AS gold,
             SUM(bills) AS bills, SUM(units) AS units, COUNT(*) FILTER (WHERE bills > 0) AS days
      FROM lfl_staff_sales
      WHERE date >= ${day(range.from)} AND date <= ${day(range.to)}
      GROUP BY "storeKey", "staffId"`;
    return rows.map((r) => ({
      storeId: r.storeKey,
      staffId: r.staffId,
      name: r.name,
      sales: Number(r.sales),
      gold: Number(r.gold),
      bills: Number(r.bills),
      units: Number(r.units),
      days: Number(r.days),
    }));
  }

  async staffPerformance(): Promise<{ sales: StaffSaleMonthRecord[]; registers: StaffRegisterRecord[] } | null> {
    const [sales, registers, links] = await Promise.all([
      prisma.$queryRaw<
        { month: Date; storeKey: string; staffId: string; name: string | null; sales: number; gold: number; bills: bigint; units: number; days: bigint }[]
      >`SELECT date_trunc('month', date)::date AS month, "storeKey", "staffId", MAX("staffName") AS name,
               SUM(sales) AS sales, SUM(gold) AS gold, SUM(bills) AS bills, SUM(units) AS units,
               COUNT(*) FILTER (WHERE bills > 0) AS days
        FROM lfl_staff_sales WHERE "staffId" <> ''
        GROUP BY 1, 2, 3`,
      prisma.lflStaffMonth.findMany(),
      prisma.lflBranchMap.findMany({ where: { storeKey: { not: null } } }),
    ]);
    if (!sales.length || !registers.length) return null;
    const storeOf = new Map(links.map((l) => [l.branch, l.storeKey!]));
    return {
      sales: sales.map((r) => ({
        month: iso(r.month),
        storeId: r.storeKey,
        staffId: r.staffId,
        name: r.name,
        sales: Number(r.sales),
        gold: Number(r.gold),
        bills: Number(r.bills),
        units: Number(r.units),
        days: Number(r.days),
      })),
      registers: registers.map((r) => ({
        month: iso(r.month),
        employeeNo: r.employeeNo,
        name: r.name,
        storeId: storeOf.get(r.branch) ?? null,
        role: r.designation,
        joinedOn: iso(r.joinDate),
        leftOn: r.leaveDate ? iso(r.leaveDate) : null,
      })),
    };
  }

  async staffHistory(): Promise<StaffMonthRecord[] | null> {
    const [rows, links] = await Promise.all([
      prisma.lflStaffMonth.findMany({ select: { month: true, branch: true, joinDate: true, leaveDate: true } }),
      prisma.lflBranchMap.findMany({ where: { storeKey: { not: null } } }),
    ]);
    if (!rows.length) return null;
    const storeOf = new Map(links.map((l) => [l.branch, l.storeKey!]));
    const out = new Map<string, StaffMonthRecord>();
    for (const r of rows) {
      const storeId = storeOf.get(r.branch);
      if (!storeId) continue;
      const month = iso(r.month);
      const next = nextMonth(month);
      const joined = iso(r.joinDate);
      const left = r.leaveDate ? iso(r.leaveDate) : null;
      if (left && left < month) continue; // already gone, on the register only for settlement
      const key = `${month}|${storeId}`;
      const rec = out.get(key) ?? { month, storeId, headcount: 0, joined: 0, left: 0 };
      if (joined >= month && joined < next) rec.joined++;
      if (left && left < next) rec.left++;
      else if (joined < next) rec.headcount++;
      out.set(key, rec);
    }
    return [...out.values()];
  }
}

export function createPostgresLflRepository(): LflRepository {
  return instrumentObject(new PostgresLflRepository(), {
    namePrefix: "lfl.repository.postgres",
    captureResult: false,
  });
}
