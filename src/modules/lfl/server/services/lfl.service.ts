import "server-only";

import { NotFoundError, parseOrThrow } from "@foundry/api-core";
import { instrumentObject, logger } from "@foundry/logger";
import {
  CITY_GROUPS,
  GOLD_SEGMENTS,
  LflFiltersSchema,
  REST_OF_INDIA,
  SILVER_SEGMENTS,
  SQFT_BANDS,
  StoreDetailInputSchema,
  TENURE_BANDS,
  type CategoryRowDto,
  type ConcernRowDto,
  type GroupRowDto,
  type LflDashboardDto,
  type StaffMemberDto,
  type StaffSalesRowDto,
  type TenureSalesDto,
  type LflFilters,
  type MetalCounts,
  type Pair,
  type PeerGroupDto,
  type StoreDetailDto,
  type SegmentRowDto,
  type StoreRowDto,
  type TrendGrain,
  type TrendPointDto,
} from "../../contracts";
import type {
  InventoryRecord,
  Metal,
  PeriodRanges,
  SegmentRecord,
  StaffMonthRecord,
  StaffRecord,
  StaffSaleRecord,
  StoreDayRecord,
  StoreRecord,
} from "../models";
import type { LflRepository, StoreProfileRepository } from "../repositories";
import {
  addDays,
  dayLabel,
  monthLabel,
  monthStart,
  monthsBetween,
  shiftYears,
  alignLy,
  latestCompleteDay,
  weekStart,
} from "./lfl.dates";
import { staffLinker, tenureVsSales } from "./staff-performance";

const REGION_ORDER = ["North", "South", "East", "West"];
const SUBREGION_ORDER = ["N1", "N2", "S1", "S2", "East", "W1", "W2", "Unassigned"];
const CITY_ORDER: string[] = [...CITY_GROUPS, REST_OF_INDIA];
/** Spellings that belong to a metro group (Delhi NCR covers the satellite cities). */
const CITY_ALIAS: Record<string, string> = {
  delhi: "Delhi NCR", newdelhi: "Delhi NCR", delhincr: "Delhi NCR", gurgaon: "Delhi NCR", gurugram: "Delhi NCR",
  noida: "Delhi NCR", greaternoida: "Delhi NCR", ghaziabad: "Delhi NCR", faridabad: "Delhi NCR",
  bengaluru: "Bengaluru", bangalore: "Bengaluru", hyderabad: "Hyderabad", secunderabad: "Hyderabad",
  mumbai: "Mumbai", bombay: "Mumbai", pune: "Pune", chennai: "Chennai", madras: "Chennai",
  kolkata: "Kolkata", calcutta: "Kolkata", ahmedabad: "Ahmedabad", ahmadabad: "Ahmedabad",
};
export const cityGroup = (city: string) => CITY_ALIAS[city.toLowerCase().replace(/[^a-z]/g, "")] ?? REST_OF_INDIA;
const AGE_ORDER = ["36 months +", "24 to 36 months", "12 to 24 months", "Under 12 months", "Unknown"];
const CATEGORY_NAMES: Record<string, string> = {
  R: "Rings",
  PD: "Pendants",
  ER: "Earrings",
  BR: "Bracelets",
  A: "Anklets",
  CH: "Chains",
  TR: "Toe rings",
  NP: "Nose pins",
  RK: "Rakhis",
  OTHER: "Other",
};
/** Categories under this share of sales in both periods fold into "Other". */
const MINOR_CATEGORY_SHARE = 0.005;

const zero = (): Pair => ({ ty: 0, ly: 0 });
const add = (pair: Pair, period: "TY" | "LY", value: number) => {
  if (period === "TY") pair.ty += value;
  else pair.ly += value;
};
const sumPairs = (pairs: Pair[]): Pair =>
  pairs.reduce((acc, pair) => ({ ty: acc.ty + pair.ty, ly: acc.ly + pair.ly }), zero());

/** Latest stock-count day in a period, when the source reports one. */
const snapshotOf = (rows: InventoryRecord[], period: "TY" | "LY") =>
  rows
    .filter((r) => r.period === period && r.snapshotDate)
    .map((r) => r.snapshotDate!)
    .sort()
    .pop();

export const normName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * GIVA's LFL rule, as in "LFL Metrics Main" (#8734): a store is
 * like-for-like when its first order is more than 365 days before the start
 * of the period. Returns that cutoff date (first order must be before it).
 */
export function lflCutoff(from: string): string {
  return addDays(from, -365);
}

/** Stores #8734 always leaves out of LFL. */
const LFL_EXCLUDED = new Set(
  [
    "Himayath Nagar HS", "ELANTE CHANDIGARH", "JM Road Pune HS", "SILVER ARC MALL", "Nexus Sujana", "Birhana HS",
    "Aerohub Mall", "Banjara Hills HS", "Karkhana HS", "Offline Activations-Mumbai", "Laxmi Road HS", "Garuda Mall",
    "Bundgarden HS",
  ].map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""))
);
export const isLflExcluded = (name: string) => LFL_EXCLUDED.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""));

export function ageBucket(firstSaleOn: string | null, asOf: string): string {
  if (!firstSaleOn) return "Unknown";
  const months = monthsBetween(firstSaleOn, asOf);
  if (months >= 36) return "36 months +";
  if (months >= 24) return "24 to 36 months";
  if (months >= 12) return "12 to 24 months";
  return "Under 12 months";
}

function bucketStart(date: string, grain: TrendGrain): string {
  if (grain === "D") return date;
  if (grain === "W") return weekStart(date);
  return monthStart(date);
}

function bucketLabel(start: string, grain: TrendGrain): string {
  if (grain === "M") return monthLabel(start);
  if (grain === "W") return `Wk of ${dayLabel(start)}`;
  return dayLabel(start);
}

const byOrder = (order: string[]) => (a: string, b: string) => {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
};
const uniqueSorted = (values: string[], order: string[] = []) =>
  [...new Set(values)].sort(byOrder(order));

type EnrichedStore = Omit<StoreRecord, "type" | "subregion"> & { type: string; subregion: string; age: string; isLfl: boolean };

const UNKNOWN_TYPE = "Unclassified";
/** A store not marked Closed with no sale for this many days before the period end looks shut. */
const SHUT_AFTER_DAYS = 30;
/** Marked Closed and no sale after `date`: a store still billing later was open then, whatever the flag says. */
const closedBy = (store: { status?: string | null; lastSaleOn?: string | null }, date: string) =>
  store.status === "Closed" && !(store.lastSaleOn && store.lastSaleOn > date);

type StoreTotals = {
  sales: Pair;
  gold: Pair;
  silver: Pair;
  bills: Pair;
  goldBills: Pair;
  footfall: Pair;
  /** Bills on days the store had counted footfall: the numerator of conversion. */
  billsWithFootfall: Pair;
} & MetalCounts;

const TOTAL_KEYS = [
  "sales", "gold", "silver", "bills", "goldBills", "footfall", "billsWithFootfall",
  "silverBills", "goldUnits", "silverUnits", "goldLineSales", "silverLineSales",
  "goldMtoSales", "goldMtoBills", "goldMtoUnits", "goldMtoLineSales",
] as const satisfies readonly (keyof StoreTotals)[];

const minus = (a: Pair, b: Pair): Pair => ({ ty: a.ty - b.ty, ly: a.ly - b.ly });

const emptyTotals = (): StoreTotals => Object.fromEntries(TOTAL_KEYS.map((k) => [k, zero()])) as StoreTotals;

export class LflService {
  /** End of the period being built; storeRows judges "looks shut" against it. */
  private asOf = "9999-12-31";

  constructor(
    private readonly data: LflRepository,
    private readonly profiles: StoreProfileRepository | null
  ) {}

  async getDashboard(input: unknown): Promise<LflDashboardDto> {
    const ctx = await this.load(input);
    const { filters, ranges, allStores, selected, selectedAll, scoped, perStore, perStoreAll, unitsByStore } = ctx;
    const totals = this.sumTotals([...perStore.values()]);
    const storesTrading: Pair = {
      ty: [...perStore.values()].filter((t) => t.sales.ty > 0).length,
      ly: [...perStore.values()].filter((t) => t.sales.ly > 0).length,
    };
    const metals = this.metals(totals, scoped.segments);
    const staffView = this.staffView(scoped.staff, ranges.to, perStore, scoped.staffHistory);
    const storeName = new Map(allStores.map((st) => [st.id, st.name]));
    staffView.summary.sales = this.staffSalesRows(scoped.staffSales, scoped.staff, storeName, ranges.to);
    staffView.summary.tenureVsSales = ctx.raw.staffPerformance
      ? tenureVsSales(ctx.raw.staffPerformance.sales, ctx.raw.staffPerformance.registers, new Set(selected.map((st) => st.id)), ranges.to)
      : null;
    const { mixNotes, ...mix } = this.mixSections(scoped.segments, scoped.inventory, ranges);

    // Count stores that traded in either period; the master list also has closed and not-yet-open ones.
    const trading = selected.filter((store) => perStore.has(store.id));
    const missingArea = trading.filter((store) => store.sqft == null).length;
    if (missingArea > 0 && !filters.sqft) {
      ctx.notes.push(`${missingArea} of ${trading.length} stores have no carpet area yet.`);
    }
    ctx.notes.push(...mixNotes);
    const mislabelled = selectedAll.filter(
      (store) => store.status === "Closed" && store.lastSaleOn && store.lastSaleOn >= addDays(latestCompleteDay(), -SHUT_AFTER_DAYS)
    );
    if (mislabelled.length) {
      ctx.notes.push(
        `${mislabelled.length} store${mislabelled.length === 1 ? " is" : "s are"} marked Closed in the store master but still billing (${mislabelled.map((s) => s.name).slice(0, 4).join(", ")}${mislabelled.length > 4 ? ", …" : ""}): the status needs fixing.`
      );
    }
    const gone = selected.filter((store) => {
      const t = perStore.get(store.id);
      return t && t.sales.ly > 0 && t.sales.ty <= 0;
    });
    if (gone.length) {
      const closed = gone.filter((store) => closedBy(store, filters.to));
      const open = gone.filter((store) => !closedBy(store, filters.to));
      const parts = [closed.length ? `${closed.length} marked Closed in the store master` : "", open.length ? `${open.length} still marked Live (${open.map((s) => s.name).slice(0, 4).join(", ")}${open.length > 4 ? ", …" : ""}): check whether they have shut` : ""].filter(Boolean);
      ctx.notes.push(
        `${gone.length} store${gone.length === 1 ? "" : "s"} sold last year but not in this period: ${parts.join("; ")}. Their last-year sales stay in the comparison${filters.excludeClosed ? " unless marked Closed" : " (as in #8734); \"Exclude closed stores\" in the filters removes the closed ones"}.`
      );
    }

    return {
      meta: this.meta(ctx, trading.length),
      options: {
        regions: uniqueSorted(allStores.map((s) => s.region), REGION_ORDER),
        subregions: uniqueSorted(allStores.map((s) => s.subregion), SUBREGION_ORDER),
        cities: uniqueSorted(allStores.map((s) => s.city)),
        ams: uniqueSorted(allStores.map((s) => s.am)),
        ages: uniqueSorted(allStores.map((s) => s.age), AGE_ORDER),
        types: uniqueSorted(allStores.map((s) => s.type), ["Mall", "HS", UNKNOWN_TYPE]),
      },
      totals: { ...totals, stores: storesTrading },
      trend: { grain: filters.grain, points: this.trend(scoped.days, filters.grain, ranges) },
      regions: this.groupBy(selected, perStore, unitsByStore, (store) => store.region, REGION_ORDER),
      subregions: this.groupBy(selected, perStore, unitsByStore, (store) => store.subregion, SUBREGION_ORDER),
      cities: this.groupBy(selected, perStore, unitsByStore, (store) => cityGroup(store.city), CITY_ORDER),
      ages: this.groupBy(selectedAll, perStoreAll, unitsByStore, (store) => store.age, AGE_ORDER).map((g) =>
        g.key === "Under 12 months" ? { ...g, comparable: false } : g
      ),
      ams: this.groupBy(selected, perStore, unitsByStore, (store) => store.am, []),
      concerns: await this.concerns(filters, selected),
      ...mix,
      metals,
      staff: staffView.summary,
      stores: this.storeRows(selected, perStore, scoped.inventory, staffView.byStore),
      // Raw inventory: the repository returns every store's stock, and storeRows picks per store.
      allStores: this.storeRows(selectedAll, perStoreAll, ctx.raw.inventory, staffView.byStore),
    };
  }

  /**
   * Revenue LFL month by month for the year so far (calendar or financial),
   * whatever the selected date range. A month counts as degrowing when the
   * store had last-year sales that month and this year's are lower.
   */
  private async concerns(filters: LflFilters, stores: EnrichedStore[]): Promise<LflDashboardDto["concerns"]> {
    const to = filters.to;
    const [y, m] = to.split("-").map(Number) as [number, number];
    const from = filters.concernBasis === "fytd" ? `${m >= 4 ? y : y - 1}-04-01` : `${y}-01-01`;
    // Read the whole year so far, whatever the end date, so every end date in a year shares one
    // (cached) read; days after `to` are dropped below.
    const yearEnd = addDays(shiftYears(from, 1), -1);
    const readTo = [yearEnd, latestCompleteDay()].sort()[0]! < to ? to : [yearEnd, latestCompleteDay()].sort()[0]!;
    const ranges: PeriodRanges = { from, to: readTo, lyFrom: shiftYears(from, -1), lyTo: shiftYears(readTo, -1) };
    const ids = new Set(stores.map((s) => s.id));
    const days = (await this.data.storeDays(ranges)).filter((d) => ids.has(d.storeId));

    const months: string[] = [];
    for (let d = monthStart(from); d <= to; d = monthStart(addDays(d, 32))) months.push(d.slice(0, 7));

    const byStore = new Map<string, Map<string, Pair>>();
    for (const day of days) {
      const aligned = day.period === "TY" ? day.date : shiftYears(day.date, 1);
      if (aligned < from || aligned > to) continue;
      const month = aligned.slice(0, 7);
      const perMonth = byStore.get(day.storeId) ?? new Map<string, Pair>();
      const pair = perMonth.get(month) ?? zero();
      add(pair, day.period, day.sales);
      perMonth.set(month, pair);
      byStore.set(day.storeId, perMonth);
    }

    const rows: ConcernRowDto[] = [];
    for (const store of stores) {
      const perMonth = byStore.get(store.id);
      if (!perMonth) continue;
      const cells = months.map((month) => {
        const sales = perMonth.get(month) ?? zero();
        return { month, sales, lfl: sales.ly > 0 ? sales.ty / sales.ly - 1 : null };
      });
      const degrowingMonths = cells.filter((c) => c.lfl != null && c.lfl < 0).length;
      if (degrowingMonths === 0) continue;
      rows.push({
        id: store.id,
        name: store.name,
        city: store.city,
        region: store.region,
        am: store.am,
        age: store.age,
        type: store.type,
        months: cells,
        degrowingMonths,
        ytd: sumPairs(cells.map((c) => c.sales)),
      });
    }
    const lfl = (p: Pair) => (p.ly > 0 ? p.ty / p.ly - 1 : 0);
    rows.sort((a, b) => b.degrowingMonths - a.degrowingMonths || lfl(a.ytd) - lfl(b.ytd));
    return { basis: filters.concernBasis, from, to, months, rows };
  }

  /**
   * Everything about one store for the same date range. Ranks and peer
   * groups use the stores in view under the current filters.
   */
  async getStoreDetail(input: unknown): Promise<StoreDetailDto> {
    const { storeId } = parseOrThrow(StoreDetailInputSchema, input);
    const ctx = await this.load(input);
    const { filters, ranges, allStores, selected, perStore } = ctx;
    const store = allStores.find((s) => s.id === storeId);
    if (!store) {
      throw new NotFoundError("Store", storeId);
    }

    const only = <T extends { storeId: string }>(rows: T[]) => rows.filter((row) => row.storeId === storeId);
    const days = only(ctx.raw.days);
    const inventory = ctx.raw.inventory ? only(ctx.raw.inventory) : null;
    const staff = ctx.raw.staff ? only(ctx.raw.staff) : null;
    const storeSales = ctx.raw.staffSales ? only(ctx.raw.staffSales).filter((x) => x.staffId) : null;
    const link = staffLinker((staff ?? []).map((p) => ({ ...p, employeeNo: p.staffId })));
    const sellerOf = new Map<string, { sales: number; bills: number }>();
    const unlinkedSellers: StaffMemberDto[] = [];
    for (const sale of storeSales ?? []) {
      const person = link(sale);
      if (person) {
        const prev = sellerOf.get(person.staffId) ?? { sales: 0, bills: 0 };
        sellerOf.set(person.staffId, { sales: prev.sales + sale.sales, bills: prev.bills + sale.bills });
      } else if (sale.bills > 0) {
        unlinkedSellers.push({
          id: sale.staffId,
          name: sale.name,
          role: null,
          startedOn: ranges.from,
          leftOn: null,
          tenureMonths: 0,
          active: true,
          sales: sale.sales,
          bills: sale.bills,
          onRegister: false,
        });
      }
    }
    const own = this.totalsByStore(days).get(storeId) ?? this.sumTotals([]);
    const { mixNotes, ...mix } = this.mixSections(ctx.raw.segments ? only(ctx.raw.segments) : null, inventory, ranges);
    ctx.notes.push(...mixNotes);

    // Rank among the stores in view; LFL rank only among stores with a base.
    const inView = [...perStore.values()];
    const position = (value: (t: StoreTotals) => number | null) => {
      const mineTotals = perStore.get(storeId);
      const mine = mineTotals ? value(mineTotals) : null;
      if (mine == null) return null;
      return 1 + inView.filter((t) => (value(t) ?? Number.NEGATIVE_INFINITY) > mine).length;
    };
    const lflOf = (t: StoreTotals) => (t.sales.ly > 0 ? t.sales.ty / t.sales.ly - 1 : null);

    const peerGroup = (key: PeerGroupDto["key"], label: string, members: EnrichedStore[]): PeerGroupDto => {
      const group: PeerGroupDto = {
        key,
        label,
        stores: 0,
        sales: zero(),
        bills: zero(),
        billsWithFootfall: zero(),
        footfall: zero(),
        sqft: 0,
        salesWithArea: 0,
      };
      for (const member of members) {
        const t = perStore.get(member.id);
        if (!t) continue;
        group.stores += 1;
        group.sales = sumPairs([group.sales, t.sales]);
        group.bills = sumPairs([group.bills, t.bills]);
        group.footfall = sumPairs([group.footfall, t.footfall]);
        group.billsWithFootfall = sumPairs([group.billsWithFootfall, t.billsWithFootfall]);
        if (member.sqft) {
          group.sqft += member.sqft;
          group.salesWithArea += t.sales.ty;
        }
      }
      return group;
    };

    return {
      meta: this.meta(ctx, 1),
      store: {
        id: store.id,
        name: store.name,
        city: store.city,
        region: store.region,
        am: store.am,
        age: store.age,
        type: store.type,
        sqft: store.sqft,
        isLfl: store.isLfl,
        firstSaleOn: store.firstSaleOn,
        status: store.status ?? null,
        lastSaleOn: store.lastSaleOn ?? null,
      },
      totals: own,
      rank: {
        bySales: position((t) => t.sales.ty),
        byLfl: position(lflOf),
        of: perStore.size,
      },
      peers: [
        peerGroup("region", `${store.region} region`, selected.filter((s) => s.region === store.region)),
        peerGroup("all", "All stores in view", selected),
      ],
      trend: { grain: filters.grain, points: this.trend(days, filters.grain, ranges) },
      ...mix,
      staff: {
        connected: staff !== null,
        members: (staff ?? [])
          .filter((s) => s.startedOn <= ranges.to)
          .map((s) => ({
            id: s.staffId,
            name: s.name,
            role: s.role ?? null,
            startedOn: s.startedOn,
            leftOn: s.leftOn ?? null,
            tenureMonths: monthsBetween(s.startedOn, s.leftOn && s.leftOn < ranges.to ? s.leftOn : ranges.to),
            active: s.active,
          }))
          .map((m) => ({ ...m, onRegister: true, ...(sellerOf.get(m.id) ?? { sales: storeSales ? 0 : null, bills: storeSales ? 0 : null }) }))
          .concat(unlinkedSellers)
          .sort((a, b) => Number(b.active) - Number(a.active) || (b.sales ?? 0) - (a.sales ?? 0) || b.tenureMonths - a.tenureMonths),
      },
    };
  }

  /** Reads every source for the range and applies the store filters once. */
  private async load(input: unknown) {
    const filters: LflFilters = parseOrThrow(LflFiltersSchema, input) as LflFilters;
    this.asOf = filters.to;
    const ranges: PeriodRanges = {
      from: filters.from,
      to: filters.to,
      // A festival compares with its own dates last year; otherwise the same dates a year earlier.
      lyFrom: filters.lyFrom ?? shiftYears(filters.from, -1),
      lyTo: filters.lyTo ?? shiftYears(filters.to, -1),
    };
    const notes: string[] = [];
    const optional = <T>(label: string, load: Promise<T>): Promise<T | null> =>
      load.catch((error: unknown) => {
        logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          `LFL ${label} could not be loaded`
        );
        notes.push(`${label[0]!.toUpperCase()}${label.slice(1)} could not be loaded, so that section is empty.`);
        return null;
      });

    const [stores, profiles, days, segments, inventory, staff, staffHistory, staffSales, staffPerformance] = await Promise.all([
      this.data.listStores(),
      this.profiles ? optional("carpet areas", this.profiles.list()) : Promise.resolve(null),
      this.data.storeDays(ranges),
      this.data.segments(ranges),
      optional("inventory", this.data.inventory({ ty: ranges.to, ly: ranges.lyTo })),
      optional("staff tenure", this.data.staff(ranges.to)),
      this.data.staffHistory ? optional("staff history", this.data.staffHistory()) : Promise.resolve(null),
      this.data.staffSales ? optional("staff sales", this.data.staffSales({ from: ranges.from, to: ranges.to })) : Promise.resolve(null),
      this.data.staffPerformance ? optional("staff performance", this.data.staffPerformance()) : Promise.resolve(null),
    ]);

    const sqftByName = new Map((profiles ?? []).map((p) => [normName(p.storeName), p.carpetSqft]));
    const allStores: EnrichedStore[] = stores.map((store) => ({
      ...store,
      sqft: sqftByName.get(normName(store.name)) ?? store.sqft,
      type: store.type?.trim() || UNKNOWN_TYPE,
      subregion: store.subregion?.trim() || "Unassigned",
      age: ageBucket(store.firstSaleOn, ranges.to),
      // LFL: open a year before the period, and before the comparison window when that's earlier (festivals).
      isLfl:
        Boolean(store.firstSaleOn && store.firstSaleOn < [lflCutoff(ranges.from), ranges.lyFrom].sort()[0]!) &&
        !isLflExcluded(store.name),
    }));

    const selected = allStores.filter((store) => this.matches(store, filters));
    // Same filters without the LFL toggle: views that show every store (store age, Stores tab).
    const selectedAll = allStores.filter((store) => this.matches(store, { ...filters, lflOnly: false }));
    const selectedIds = new Set(selected.map((store) => store.id));
    const allIds = new Set(selectedAll.map((store) => store.id));
    const inScope = <T extends { storeId: string }>(rows: T[]) =>
      rows.filter((row) => selectedIds.has(row.storeId));
    // Units sold per store (SKU quantity) from the segment feed, for "SKU LFL".
    let unitsByStore: Map<string, Pair> | null = null;
    if (segments) {
      unitsByStore = new Map();
      for (const seg of segments) {
        const pair = unitsByStore.get(seg.storeId) ?? zero();
        add(pair, seg.period, seg.units);
        unitsByStore.set(seg.storeId, pair);
      }
    }
    const perStoreAll = this.totalsByStore(days.filter((d) => allIds.has(d.storeId)));
    const perStore = new Map([...perStoreAll].filter(([id]) => selectedIds.has(id)));
    const scoped = {
      days: inScope(days),
      segments: segments ? inScope(segments) : null,
      inventory: inventory ? inScope(inventory) : null,
      staff: staff ? inScope(staff) : null,
      staffHistory: staffHistory ? inScope(staffHistory) : null,
      staffSales: staffSales ? inScope(staffSales) : null,
    };

    return {
      filters,
      ranges,
      notes,
      allStores,
      selected,
      selectedAll,
      raw: { days, segments, inventory, staff, staffSales, staffPerformance },
      scoped,
      perStore,
      perStoreAll,
      unitsByStore,
    };
  }

  private meta(ctx: { ranges: PeriodRanges; notes: string[] }, storeCount: number): LflDashboardDto["meta"] {
    return {
      ...ctx.ranges,
      source: this.data.source,
      generatedAt: new Date().toISOString(),
      storeCount,
      notes: ctx.notes,
    };
  }

  /** Karat, classic and category splits plus inventory, for any set of rows. */
  private mixSections(segments: SegmentRecord[] | null, inventory: InventoryRecord[] | null, ranges: PeriodRanges) {
    const connected = segments !== null;
    segments = segments ?? [];
    const unmapped = this.unmappedShares(segments);
    const mixNotes: string[] = [];
    if (unmapped.gold > 0.01) {
      mixNotes.push(`Karat isn't mapped for ${Math.round(unmapped.gold * 100)}% of gold sales yet.`);
    }
    if (unmapped.silver > 0.01) {
      mixNotes.push(`Classic / non-classic isn't mapped for ${Math.round(unmapped.silver * 100)}% of silver sales yet.`);
    }
    const stockOn = (inventory && snapshotOf(inventory, "TY")) || null;
    if (inventory && !stockOn) {
      mixNotes.push(`No stock count within 3 days of ${ranges.to}, so inventory is left out for this range.`);
    }
    return {
      mix: { connected },
      gold: connected ? this.segmentRows(segments, "GOLD", GOLD_SEGMENTS) : [],
      silver: connected ? this.segmentRows(segments, "SILVER", SILVER_SEGMENTS) : [],
      categories: {
        all: this.categoryRows(segments, inventory, null),
        gold: this.categoryRows(segments, inventory, "GOLD"),
        silver: this.categoryRows(segments, inventory, "SILVER"),
      },
      inventory: {
        connected: inventory !== null,
        asOf: stockOn,
        lyAsOf: (inventory && snapshotOf(inventory, "LY")) || null,
        total: inventory ? this.inventoryTotal(inventory) : null,
      },
      mixNotes,
    };
  }

  private matches(store: EnrichedStore, filters: LflFilters): boolean {
    if (filters.lflOnly && !store.isLfl) return false;
    if (filters.excludeClosed && closedBy(store, filters.to)) return false;
    if (filters.region && store.region !== filters.region) return false;
    if (filters.subregion && store.subregion !== filters.subregion) return false;
    if (filters.city && store.city !== filters.city) return false;
    if (filters.am && store.am !== filters.am) return false;
    if (filters.age && store.age !== filters.age) return false;
    if (filters.type && store.type !== filters.type) return false;
    if (filters.sqft) {
      const band = SQFT_BANDS.find((b) => b.key === filters.sqft)!;
      if (store.sqft == null || store.sqft < band.min || store.sqft >= band.max) return false;
    }
    return true;
  }

  private totalsByStore(days: StoreDayRecord[]): Map<string, StoreTotals> {
    const out = new Map<string, StoreTotals>();
    for (const day of days) {
      let t = out.get(day.storeId);
      if (!t) {
        t = emptyTotals();
        out.set(day.storeId, t);
      }
      add(t.sales, day.period, day.sales);
      add(t.gold, day.period, day.gold);
      add(t.silver, day.period, day.silver);
      add(t.bills, day.period, day.bills);
      add(t.goldBills, day.period, day.goldBills);
      add(t.silverBills, day.period, day.silverBills);
      add(t.goldUnits, day.period, day.goldUnits);
      add(t.silverUnits, day.period, day.silverUnits);
      add(t.goldLineSales, day.period, day.goldLineSales);
      add(t.silverLineSales, day.period, day.silverLineSales);
      add(t.goldMtoSales, day.period, day.goldMtoSales);
      add(t.goldMtoBills, day.period, day.goldMtoBills);
      add(t.goldMtoUnits, day.period, day.goldMtoUnits);
      add(t.goldMtoLineSales, day.period, day.goldMtoLineSales);
      add(t.footfall, day.period, day.footfall);
      if (day.footfall > 0) add(t.billsWithFootfall, day.period, day.bills);
    }
    return out;
  }

  private sumTotals(list: StoreTotals[]): StoreTotals {
    return Object.fromEntries(TOTAL_KEYS.map((k) => [k, sumPairs(list.map((t) => t[k]))])) as StoreTotals;
  }

  /**
   * Gold and silver sales, units and the line sales ASP divides (as #8734).
   * Days loaded before the daily feed carried units have none; then units come
   * from the karat / category feed and ASP is net sales ÷ units.
   */
  private metals(totals: StoreTotals, segments: SegmentRecord[] | null): LflDashboardDto["metals"] {
    const fromDaily = totals.goldUnits.ty + totals.goldUnits.ly + totals.silverUnits.ty + totals.silverUnits.ly > 0;
    const segUnits = segments && !fromDaily ? { GOLD: zero(), SILVER: zero() } : null;
    for (const seg of segUnits ? segments! : []) add(segUnits![seg.metal], seg.period, seg.units);
    return [
      {
        key: "gold",
        label: "Gold",
        sales: totals.gold,
        units: fromDaily ? totals.goldUnits : (segUnits?.GOLD ?? null),
        lineSales: fromDaily ? totals.goldLineSales : null,
      },
      // Gold split into made-to-order and ready stock; the two add up to gold.
      ...(fromDaily && totals.goldMtoBills.ty + totals.goldMtoBills.ly > 0
        ? ([
            {
              key: "gold-stock",
              label: "Ready stock",
              sub: true,
              sales: minus(totals.gold, totals.goldMtoSales),
              units: minus(totals.goldUnits, totals.goldMtoUnits),
              lineSales: minus(totals.goldLineSales, totals.goldMtoLineSales),
            },
            { key: "gold-mto", label: "Made to order (MTO)", sub: true, sales: totals.goldMtoSales, units: totals.goldMtoUnits, lineSales: totals.goldMtoLineSales, bills: totals.goldMtoBills },
          ] as LflDashboardDto["metals"])
        : []),
      {
        key: "silver",
        label: "Silver",
        sales: totals.silver,
        units: fromDaily ? totals.silverUnits : (segUnits?.SILVER ?? null),
        lineSales: fromDaily ? totals.silverLineSales : null,
      },
    ];
  }

  /** Last-year days are moved onto this year's dates (a year forward, or festival day to festival day). */
  private trend(days: StoreDayRecord[], grain: TrendGrain, ranges: PeriodRanges): TrendPointDto[] {
    const buckets = new Map<string, TrendPointDto>();
    const toThisYear = alignLy(ranges);
    for (const day of days) {
      const aligned = day.period === "TY" ? day.date : toThisYear(day.date);
      if (aligned < ranges.from || aligned > ranges.to) continue;
      // A partial first week/month is labelled from the range start, not before it.
      const bucket = bucketStart(aligned, grain);
      const start = bucket < ranges.from ? ranges.from : bucket;
      let point = buckets.get(start);
      if (!point) {
        point = { start, label: bucketLabel(start, grain), sales: zero(), gold: zero(), silver: zero() };
        buckets.set(start, point);
      }
      add(point.sales, day.period, day.sales);
      add(point.gold, day.period, day.gold);
      add(point.silver, day.period, day.silver);
    }
    return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  private groupBy(
    stores: EnrichedStore[],
    perStore: Map<string, StoreTotals>,
    unitsByStore: Map<string, Pair> | null,
    keyOf: (store: EnrichedStore) => string,
    order: string[]
  ): GroupRowDto[] {
    const groups = new Map<string, GroupRowDto>();
    for (const store of stores) {
      const totals = perStore.get(store.id);
      if (!totals) continue;
      const key = keyOf(store);
      const group = groups.get(key) ?? {
        key,
        stores: 0,
        sales: zero(),
        gold: zero(),
        silver: zero(),
        bills: zero(),
        goldBills: zero(),
        silverBills: zero(),
        footfall: zero(),
        billsWithFootfall: zero(),
        trading: zero(),
        units: unitsByStore ? zero() : null,
      };
      group.stores += 1;
      group.sales = sumPairs([group.sales, totals.sales]);
      group.gold = sumPairs([group.gold, totals.gold]);
      group.silver = sumPairs([group.silver, totals.silver]);
      group.bills = sumPairs([group.bills, totals.bills]);
      group.goldBills = sumPairs([group.goldBills, totals.goldBills]);
      group.silverBills = sumPairs([group.silverBills, totals.silverBills]);
      group.footfall = sumPairs([group.footfall, totals.footfall]);
      group.billsWithFootfall = sumPairs([group.billsWithFootfall, totals.billsWithFootfall]);
      group.trading = sumPairs([group.trading, { ty: totals.sales.ty > 0 ? 1 : 0, ly: totals.sales.ly > 0 ? 1 : 0 }]);
      if (group.units && unitsByStore) group.units = sumPairs([group.units, unitsByStore.get(store.id) ?? zero()]);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => byOrder(order)(a.key, b.key));
  }

  private segmentRows(
    segments: SegmentRecord[],
    metal: Metal,
    known: readonly { key: string; label: string }[]
  ): SegmentRowDto[] {
    const rows = new Map<string, SegmentRowDto>(
      known.map(({ key, label }) => [key, { key, label, sales: zero(), units: zero() }])
    );
    for (const row of segments) {
      if (row.metal !== metal) continue;
      const key = rows.has(row.segment) ? row.segment : "UNMAPPED";
      const entry = rows.get(key) ?? { key, label: "Unmapped", sales: zero(), units: zero() };
      add(entry.sales, row.period, row.sales);
      add(entry.units, row.period, row.units);
      rows.set(key, entry);
    }
    return [...rows.values()];
  }

  private unmappedShares(segments: SegmentRecord[]) {
    const share = (metal: Metal, known: readonly { key: string }[]) => {
      const keys = new Set(known.map((k) => k.key));
      let total = 0;
      let unmapped = 0;
      for (const row of segments) {
        if (row.metal !== metal || row.period !== "TY") continue;
        total += row.sales;
        if (!keys.has(row.segment)) unmapped += row.sales;
      }
      return total > 0 ? unmapped / total : 0;
    };
    return { gold: share("GOLD", GOLD_SEGMENTS), silver: share("SILVER", SILVER_SEGMENTS) };
  }

  private categoryRows(
    segments: SegmentRecord[],
    inventory: InventoryRecord[] | null,
    metal: Metal | null
  ): CategoryRowDto[] {
    const rows = new Map<string, CategoryRowDto>();
    const rowFor = (code: string) => {
      let row = rows.get(code);
      if (!row) {
        row = {
          key: code,
          label: CATEGORY_NAMES[code] ?? code,
          sales: zero(),
          units: zero(),
          inventory: inventory ? zero() : null,
        };
        rows.set(code, row);
      }
      return row;
    };
    for (const seg of segments) {
      if (metal && seg.metal !== metal) continue;
      const row = rowFor(seg.category);
      add(row.sales, seg.period, seg.sales);
      add(row.units, seg.period, seg.units);
    }
    for (const inv of inventory ?? []) {
      if (metal && inv.metal !== metal) continue;
      add(rowFor(inv.category).inventory!, inv.period, inv.units);
    }

    const total = sumPairs([...rows.values()].map((r) => r.sales));
    const isMinor = (row: CategoryRowDto) =>
      row.key !== "OTHER" &&
      row.sales.ty < total.ty * MINOR_CATEGORY_SHARE &&
      row.sales.ly < total.ly * MINOR_CATEGORY_SHARE;
    const major = [...rows.values()].filter((row) => !isMinor(row));
    const minor = [...rows.values()].filter(isMinor);
    if (minor.length > 0) {
      const other = major.find((row) => row.key === "OTHER") ?? {
        key: "OTHER",
        label: CATEGORY_NAMES.OTHER!,
        sales: zero(),
        units: zero(),
        inventory: inventory ? zero() : null,
      };
      for (const row of minor) {
        other.sales = sumPairs([other.sales, row.sales]);
        other.units = sumPairs([other.units, row.units]);
        if (other.inventory && row.inventory) other.inventory = sumPairs([other.inventory, row.inventory]);
      }
      if (!major.includes(other)) major.push(other);
    }
    return major.sort((a, b) =>
      a.key === "OTHER" ? 1 : b.key === "OTHER" ? -1 : b.sales.ty - a.sales.ty
    );
  }

  private inventoryTotal(inventory: InventoryRecord[]): Pair {
    const total = zero();
    for (const row of inventory) add(total, row.period, row.units);
    return total;
  }

  /** Sales per salesperson in the range, with role and tenure from the HR register when linked. */
  private staffSalesRows(
    sales: StaffSaleRecord[] | null,
    register: StaffRecord[] | null,
    storeName: Map<string, string>,
    asOf: string
  ): StaffSalesRowDto[] {
    if (!sales) return [];
    const link = staffLinker((register ?? []).map((p) => ({ ...p, employeeNo: p.staffId })));
    return sales
      .filter((x) => x.staffId && (x.sales !== 0 || x.bills > 0))
      .map((x) => {
        const person = link(x);
        return {
          id: x.staffId,
          name: person?.name ?? x.name ?? x.staffId,
          storeId: x.storeId,
          storeName: storeName.get(x.storeId) ?? x.storeId,
          employeeNo: person?.staffId ?? null,
          role: person?.role ?? null,
          tenureMonths: person ? monthsBetween(person.startedOn, asOf) : null,
          sales: x.sales,
          gold: x.gold,
          bills: x.bills,
          units: x.units,
          days: x.days,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }

  private staffView(
    staff: StaffRecord[] | null,
    asOf: string,
    perStore: Map<string, StoreTotals>,
    history: StaffMonthRecord[] | null = null
  ) {
    const byStore = new Map<string, { count: number; avgMonths: number }>();
    if (!staff) {
      return {
        byStore,
        summary: {
          connected: false,
          headcount: 0,
          avgTenureMonths: null,
          bands: [],
          lflByTenure: [],
          roles: [],
          monthly: [],
          sales: [] as StaffSalesRowDto[],
          tenureVsSales: null as TenureSalesDto | null,
        } satisfies LflDashboardDto["staff"],
      };
    }
    const monthlyMap = new Map<string, { month: string; headcount: number; joined: number; left: number }>();
    for (const h of history ?? []) {
      const m = monthlyMap.get(h.month) ?? { month: h.month, headcount: 0, joined: 0, left: 0 };
      m.headcount += h.headcount;
      m.joined += h.joined;
      m.left += h.left;
      monthlyMap.set(h.month, m);
    }
    const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

    const active = staff.filter((s) => s.active && s.startedOn <= asOf);
    const months = active.map((s) => ({ storeId: s.storeId, months: monthsBetween(s.startedOn, asOf), role: s.role ?? null }));
    const roleMap = new Map<string, { staff: number; total: number }>();
    for (const m of months) {
      if (!m.role) continue;
      const r = roleMap.get(m.role) ?? { staff: 0, total: 0 };
      r.staff += 1;
      r.total += m.months;
      roleMap.set(m.role, r);
    }
    const roles = [...roleMap]
      .map(([role, r]) => ({ role, staff: r.staff, avgTenureMonths: r.total / r.staff }))
      .sort((a, b) => b.staff - a.staff);
    const bandOf = (value: number) => TENURE_BANDS.find((b) => value >= b.min && value < b.max)!;

    const sums = new Map<string, { count: number; total: number }>();
    for (const m of months) {
      const entry = sums.get(m.storeId) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += m.months;
      sums.set(m.storeId, entry);
    }
    for (const [storeId, { count, total }] of sums) {
      byStore.set(storeId, { count, avgMonths: total / count });
    }

    const lflByTenure = TENURE_BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      stores: 0,
      sales: zero(),
    }));
    for (const [storeId, { avgMonths }] of byStore) {
      const totals = perStore.get(storeId);
      if (!totals) continue;
      const group = lflByTenure.find((g) => g.key === bandOf(avgMonths).key)!;
      group.stores += 1;
      group.sales = sumPairs([group.sales, totals.sales]);
    }

    return {
      byStore,
      summary: {
        connected: true,
        headcount: active.length,
        avgTenureMonths: months.length
          ? months.reduce((sum, m) => sum + m.months, 0) / months.length
          : null,
        bands: TENURE_BANDS.map((band) => ({
          key: band.key,
          label: band.label,
          staff: months.filter((m) => bandOf(m.months).key === band.key).length,
        })),
        lflByTenure,
        roles,
        monthly,
        sales: [] as StaffSalesRowDto[],
        tenureVsSales: null as TenureSalesDto | null,
      } satisfies LflDashboardDto["staff"],
    };
  }

  private storeRows(
    stores: EnrichedStore[],
    perStore: Map<string, StoreTotals>,
    inventory: InventoryRecord[] | null,
    staff: Map<string, { count: number; avgMonths: number }>
  ): StoreRowDto[] {
    const invByStore = new Map<string, Pair>();
    for (const row of inventory ?? []) {
      const pair = invByStore.get(row.storeId) ?? zero();
      add(pair, row.period, row.units);
      invByStore.set(row.storeId, pair);
    }

    const rows: StoreRowDto[] = [];
    for (const store of stores) {
      const totals = perStore.get(store.id);
      if (!totals) continue;
      const people = staff.get(store.id);
      rows.push({
        id: store.id,
        name: store.name,
        city: store.city,
        cityGroup: cityGroup(store.city),
        subregion: store.subregion,
        region: store.region,
        am: store.am,
        age: store.age,
        type: store.type,
        sqft: store.sqft,
        openedOn: store.firstSaleOn,
        status: store.status ?? null,
        lastSaleOn: store.lastSaleOn ?? null,
        looksShut: store.status !== "Closed" && Boolean(store.lastSaleOn) && store.lastSaleOn! < addDays(this.asOf, -SHUT_AFTER_DAYS),
        closedButSelling: store.status === "Closed" && Boolean(store.lastSaleOn) && store.lastSaleOn! >= addDays(latestCompleteDay(), -SHUT_AFTER_DAYS),
        lat: store.lat ?? null,
        lng: store.lng ?? null,
        isLfl: store.isLfl,
        ...totals,
        inventory: inventory ? invByStore.get(store.id) ?? zero() : null,
        staff: people?.count ?? null,
        avgTenureMonths: people?.avgMonths ?? null,
      });
    }
    return rows.sort((a, b) => b.sales.ty - a.sales.ty);
  }
}

export function createLflService(
  data: LflRepository,
  profiles: StoreProfileRepository | null
): LflService {
  return instrumentObject(new LflService(data, profiles), {
    namePrefix: "lfl.service",
    captureResult: false,
  });
}
