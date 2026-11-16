import { SQFT_BANDS, type ConcernRowDto, type GroupRowDto, type LflDashboardDto, type Pair, type ReportKey, type StaffSalesRowDto, type StoreRowDto, type TenureSalesDto } from "../contracts";
import { growth, growthOf, pts, ratio, ratioPair, sliceGrowth, sumPair } from "./math";
import { categoryTable, METAL_LABEL, metricRow, metricsTable, segmentTable, trendTable, type MetalView } from "./shared";
import { col, type AnyReportTable, type ReportTable } from "./types";

export const REPORT_TITLES: Record<ReportKey, string> = {
  summary: "LFL summary",
  trend: "LFL growth over time",
  metals: "Gold & silver",
  regions: "Region",
  subregions: "Sub-region",
  cities: "Cities",
  ages: "Store age",
  ams: "Area managers",
  concerns: "Concern stores",
  sqft: "Carpet area",
  gold: "Gold by karat",
  silver: "Silver: classic vs non-classic",
  categories: "Category",
  stores: "Stores",
  inventory: "Inventory",
  tenure: "Staff tenure",
  staffsales: "Staff sales",
  tenuresales: "Tenure vs sales",
};

/**
 * The overall view: every headline number in one table, this year vs last.
 * Karat and classic rows come from the karat / category feed (Shopify tags),
 * so they can differ slightly from gold / silver revenue (untagged lines).
 */
export function summaryTable(d: LflDashboardDto) {
  const t = d.totals;
  const perStore = (pair: { ty: number; ly: number }) => ratioPair(pair, t.stores);
  const conv = ratioPair(t.billsWithFootfall, t.footfall);
  const sps = perStore(t.sales);
  const nob = perStore(t.bills);
  const gnob = perStore(t.goldBills);
  const snob = perStore(t.silverBills);
  const metal = (key: "gold" | "silver") => d.metals.find((m) => m.key === key);
  const units = (key: "gold" | "silver") => metal(key)?.units ?? null;
  const mto = d.metals.find((m) => m.key === "gold-mto");
  const asp = (key: "gold" | "silver") => {
    const m = metal(key);
    return m?.units ? ratioPair(m.lineSales ?? m.sales, m.units) : { ty: null, ly: null };
  };
  // Untagged lines (mostly exchanges) only get a row when they're over 1% of the metal's revenue.
  const segments = (prefix: "gold" | "silver", rows: LflDashboardDto["gold"]) =>
    d.mix.connected
      ? rows
          .filter((r) => r.key !== "UNMAPPED" || Math.abs(r.sales.ty) > 0.01 * t[prefix].ty || Math.abs(r.sales.ly) > 0.01 * t[prefix].ly)
          .map((r) => {
            const row = metricRow(`${prefix}-${r.key}`, `${prefix === "gold" ? "Gold" : "Silver"} · ${r.label}`, "inr", r.sales.ty, r.sales.ly);
            return { ...row, change: { ...row.change, value: sliceGrowth(r.sales) } };
          })
      : [];
  return metricsTable(
    "summary",
    REPORT_TITLES.summary,
    [
      metricRow("sales", "Revenue", "inr", t.sales.ty, t.sales.ly),
      metricRow("gold", "Gold revenue", "inr", t.gold.ty, t.gold.ly),
      ...segments("gold", d.gold),
      ...(mto
        ? [
            metricRow("goldMto", "Gold · made to order (MTO)", "inr", mto.sales.ty, mto.sales.ly),
            metricRow("goldMtoBills", "Gold MTO orders", "int", mto.bills?.ty ?? null, mto.bills?.ly ?? null),
          ]
        : []),
      metricRow("silver", "Silver revenue", "inr", t.silver.ty, t.silver.ly),
      ...segments("silver", d.silver),
      metricRow("conversion", "Conversion", "share", conv.ty, conv.ly, "pts"),
      metricRow("salesPerStore", "Avg sales per store", "inr", sps.ty, sps.ly),
      metricRow("nobPerStore", "NOB per store", "dec", nob.ty, nob.ly),
      metricRow("goldNobPerStore", "Gold NOB per store", "dec", gnob.ty, gnob.ly),
      metricRow("silverNobPerStore", "Silver NOB per store", "dec", snob.ty, snob.ly),
      metricRow("goldQty", "Gold qty", "int", units("gold")?.ty ?? null, units("gold")?.ly ?? null),
      metricRow("silverQty", "Silver qty", "int", units("silver")?.ty ?? null, units("silver")?.ly ?? null),
      metricRow("goldAsp", "Gold ASP", "rupees", asp("gold").ty, asp("gold").ly),
      metricRow("silverAsp", "Silver ASP", "rupees", asp("silver").ty, asp("silver").ly),
      metricRow("bills", "Bills (NOB)", "int", t.bills.ty, t.bills.ly),
      metricRow("goldBills", "Gold bills", "int", t.goldBills.ty, t.goldBills.ly),
      metricRow("silverBills", "Silver bills", "int", t.silverBills.ty, t.silverBills.ly),
      metricRow("footfall", "Footfall", "int", t.footfall.ty, t.footfall.ly),
      metricRow("stores", "Stores trading", "int", t.stores.ty, t.stores.ly),
    ],
    "Per-store numbers divide by stores trading in each year. ASP = line sales ÷ qty, as LFL Metrics Main (#8734). Karat and classic come from Shopify tags; growth is blank where last year had almost no sales (e.g. 9 Kt)."
  );
}

/** Any grouping of stores (region, city, store age, AM) with the standard LFL columns. */
/** "lfl": growth columns. "perStore": sales / NOB / gold and silver NOB per trading store and conversion. Downloads carry both. */
export type GroupView = "lfl" | "perStore";

export function groupTable(
  key: string,
  title: string,
  label: string,
  rows: GroupRowDto[],
  description?: string,
  view: GroupView = "lfl"
): ReportTable<GroupRowDto> {
  const hasUnits = rows.some((r) => r.units);
  const lfl = (r: GroupRowDto, p: Pair | null) => (p && r.comparable !== false ? growth(p) : null);
  // Per trading store: this year's divided by stores selling this year, last year's by last year's.
  const per = (r: GroupRowDto, p: Pair) => ratioPair(p, r.trading);
  const conv = (r: GroupRowDto) => ratioPair(r.billsWithFootfall, r.footfall);
  const g = (r: GroupRowDto, p: { ty: number | null; ly: number | null }) =>
    r.comparable === false ? null : growthOf(p.ty, p.ly);
  const lflCols = [
    col<GroupRowDto>({ key: "salesTy", label: "Sales TY", type: "inr", value: (r) => r.sales.ty }),
    col<GroupRowDto>({ key: "salesLy", label: "Sales LY", type: "inr", value: (r) => r.sales.ly, exportOnly: true }),
    col<GroupRowDto>({ key: "lfl", label: "Rev LFL", type: "growth", value: (r) => lfl(r, r.sales) }),
    col<GroupRowDto>({ key: "gold", label: "Gold LFL", type: "growth", value: (r) => lfl(r, r.gold) }),
    col<GroupRowDto>({ key: "silver", label: "Silver LFL", type: "growth", value: (r) => lfl(r, r.silver) }),
    col<GroupRowDto>({ key: "nob", label: "NOB LFL", title: "Number of bills, this year vs last", type: "growth", value: (r) => lfl(r, r.bills) }),
    ...(hasUnits
      ? [col<GroupRowDto>({ key: "sku", label: "SKU LFL", title: "Units sold, this year vs last", type: "growth", value: (r) => lfl(r, r.units) })]
      : []),
  ];
  const perStoreCols = [
    col<GroupRowDto>({ key: "spsTy", label: "Sales / store", title: "Average sales per store this year", type: "inr", value: (r) => per(r, r.sales).ty }),
    col<GroupRowDto>({ key: "spsLy", label: "Sales / store LY", type: "inr", value: (r) => per(r, r.sales).ly, exportOnly: true }),
    col<GroupRowDto>({ key: "spsG", label: "Growth", title: "Sales per store vs last year", type: "growth", value: (r) => g(r, per(r, r.sales)) }),
    col<GroupRowDto>({ key: "nobTy", label: "NOB / store", type: "dec", value: (r) => per(r, r.bills).ty }),
    col<GroupRowDto>({ key: "nobLy", label: "NOB / store LY", type: "dec", value: (r) => per(r, r.bills).ly, exportOnly: true }),
    col<GroupRowDto>({ key: "nobG", label: "Growth", title: "NOB per store vs last year", type: "growth", value: (r) => g(r, per(r, r.bills)) }),
    col<GroupRowDto>({ key: "gnobTy", label: "Gold NOB / store", type: "dec", value: (r) => per(r, r.goldBills).ty }),
    col<GroupRowDto>({ key: "gnobLy", label: "Gold NOB / store LY", type: "dec", value: (r) => per(r, r.goldBills).ly, exportOnly: true }),
    col<GroupRowDto>({ key: "gnobG", label: "Growth", title: "Gold NOB per store vs last year", type: "growth", value: (r) => g(r, per(r, r.goldBills)) }),
    col<GroupRowDto>({ key: "snobTy", label: "Silver NOB / store", type: "dec", value: (r) => per(r, r.silverBills).ty }),
    col<GroupRowDto>({ key: "snobLy", label: "Silver NOB / store LY", type: "dec", value: (r) => per(r, r.silverBills).ly, exportOnly: true }),
    col<GroupRowDto>({ key: "snobG", label: "Growth", title: "Silver NOB per store vs last year", type: "growth", value: (r) => g(r, per(r, r.silverBills)) }),
    col<GroupRowDto>({ key: "convTy", label: "Conversion", title: "Bills on days with footfall ÷ footfall", type: "share", value: (r) => conv(r).ty }),
    col<GroupRowDto>({ key: "convLy", label: "Conversion LY", type: "share", value: (r) => conv(r).ly, exportOnly: true }),
    col<GroupRowDto>({ key: "convG", label: "Δ", title: "Conversion change in percentage points", type: "pts", value: (r) => (r.comparable === false ? null : pts(conv(r).ty, conv(r).ly)) }),
  ];
  const total: GroupRowDto = {
    key: "Total",
    stores: rows.reduce((n, r) => n + r.stores, 0),
    sales: sumPair(rows.map((r) => r.sales)),
    gold: sumPair(rows.map((r) => r.gold)),
    silver: sumPair(rows.map((r) => r.silver)),
    bills: sumPair(rows.map((r) => r.bills)),
    goldBills: sumPair(rows.map((r) => r.goldBills)),
    silverBills: sumPair(rows.map((r) => r.silverBills)),
    footfall: sumPair(rows.map((r) => r.footfall)),
    billsWithFootfall: sumPair(rows.map((r) => r.billsWithFootfall)),
    trading: sumPair(rows.map((r) => r.trading)),
    units: hasUnits ? sumPair(rows.map((r) => r.units ?? { ty: 0, ly: 0 })) : null,
    // A total that mixes in new stores has no fair last-year base either.
    comparable: rows.every((r) => r.comparable !== false),
  };
  return {
    key,
    title,
    description,
    rows,
    total: rows.length > 1 ? total : undefined,
    rowKey: (r) => r.key,
    columns: [
      col<GroupRowDto>({ key: "name", label, type: "text", value: (r) => r.key }),
      col<GroupRowDto>({ key: "stores", label: "Stores", type: "int", value: (r) => r.stores }),
      ...(view === "lfl" ? lflCols : perStoreCols),
      ...(view === "lfl" ? perStoreCols : lflCols).map((c) => ({ ...c, exportOnly: true })),
    ],
  };
}

type MetalRow = LflDashboardDto["metals"][number];

/** Gold and silver side by side: sales, quantity and ASP, this year vs last. */
export function metalsTable(d: LflDashboardDto): ReportTable<MetalRow> {
  // As #8734: line sales (before E/R and promo) ÷ units. Older data without line sales uses net sales.
  const asp = (r: MetalRow) => (r.units ? ratioPair(r.lineSales ?? r.sales, r.units) : { ty: null, ly: null });
  const hasUnits = d.metals.some((r) => r.units);
  const fromDaily = d.metals.some((r) => r.lineSales);
  return {
    key: "metals",
    title: REPORT_TITLES.metals,
    description: !hasUnits
      ? "Quantity and ASP need units in the daily feed (re-sync) or the karat / category feed."
      : fromDaily
        ? "Sales after exchanges, returns and promo. Qty is units sold; ASP = line sales ÷ qty, as LFL Metrics Main (#8734). MTO = made-to-order gold billed in store (mto_orders_new); ready stock is the rest of gold."
        : "Quantity is units sold from the karat / category feed. ASP = sales ÷ units.",
    rows: d.metals,
    rowKey: (r) => r.key,
    columns: [
      col<MetalRow>({ key: "metal", label: "Metal", type: "text", value: (r) => (r.sub ? `Gold · ${r.label}` : r.label) }),
      col<MetalRow>({ key: "salesTy", label: "Sales TY", type: "inr", value: (r) => r.sales.ty }),
      col<MetalRow>({ key: "salesLy", label: "Sales LY", type: "inr", value: (r) => r.sales.ly }),
      col<MetalRow>({ key: "salesG", label: "Growth", type: "growth", value: (r) => growth(r.sales) }),
      ...(hasUnits
        ? [
            col<MetalRow>({ key: "qtyTy", label: "Qty TY", type: "int", value: (r) => r.units?.ty ?? null }),
            col<MetalRow>({ key: "qtyLy", label: "Qty LY", type: "int", value: (r) => r.units?.ly ?? null }),
            col<MetalRow>({ key: "qtyG", label: "Growth", type: "growth", value: (r) => (r.units ? growth(r.units) : null) }),
            col<MetalRow>({ key: "aspTy", label: "ASP TY", type: "rupees", value: (r) => asp(r).ty }),
            col<MetalRow>({ key: "aspLy", label: "ASP LY", type: "rupees", value: (r) => asp(r).ly }),
            col<MetalRow>({ key: "aspG", label: "Growth", type: "growth", value: (r) => growthOf(asp(r).ty, asp(r).ly) }),
          ]
        : []),
    ],
  };
}

export function regionsTable(d: LflDashboardDto, view: GroupView = "lfl"): ReportTable<GroupRowDto> {
  return groupTable("regions", REPORT_TITLES.regions, "Region", d.regions, undefined, view);
}

export function subregionsTable(d: LflDashboardDto, view: GroupView = "lfl"): ReportTable<GroupRowDto> {
  return groupTable("subregions", REPORT_TITLES.subregions, "Sub-region", d.subregions, undefined, view);
}

export function citiesTable(d: LflDashboardDto, view: GroupView = "lfl"): ReportTable<GroupRowDto> {
  return groupTable("cities", REPORT_TITLES.cities, "City", d.cities, "Delhi NCR includes Gurugram, Noida, Ghaziabad and Faridabad.", view);
}

export function agesTable(d: LflDashboardDto, view: GroupView = "lfl"): ReportTable<GroupRowDto> {
  return groupTable(
    "ages",
    REPORT_TITLES.ages,
    "Store age",
    d.ages,
    "All stores, LFL and new. Stores under 12 months have no full last year, so their LFL shows as a dash.",
    view
  );
}

export function amsTable(d: LflDashboardDto): ReportTable<GroupRowDto> {
  return groupTable("ams", REPORT_TITLES.ams, "AM / CM", d.ams);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export function concernsTable(d: LflDashboardDto, minMonths = 3): ReportTable<ConcernRowDto> {
  const c = d.concerns;
  return {
    key: "concerns",
    title: REPORT_TITLES.concerns,
    description: `Revenue LFL by month, ${c.basis === "ytd" ? "calendar" : "financial"} year to date (${c.from} to ${c.to}). Ignores the date range but follows the other filters.`,
    rows: c.rows.filter((r) => r.degrowingMonths >= minMonths),
    rowKey: (r) => r.id,
    columns: [
      col<ConcernRowDto>({ key: "store", label: "Store", type: "text", value: (r) => r.name, sub: (r) => `${r.city} · ${r.am}` }),
      col<ConcernRowDto>({ key: "city", label: "City", type: "text", value: (r) => r.city, exportOnly: true }),
      col<ConcernRowDto>({ key: "region", label: "Region", type: "text", value: (r) => r.region, exportOnly: true }),
      col<ConcernRowDto>({ key: "am", label: "AM / CM", type: "text", value: (r) => r.am, exportOnly: true }),
      col<ConcernRowDto>({ key: "age", label: "Store age", type: "text", value: (r) => r.age, exportOnly: true }),
      col<ConcernRowDto>({ key: "type", label: "Store type", type: "text", value: (r) => r.type, exportOnly: true }),
      col<ConcernRowDto>({ key: "months", label: "Months down", title: "Months with lower revenue than last year", type: "int", value: (r) => r.degrowingMonths }),
      col<ConcernRowDto>({ key: "ytdTy", label: "YTD sales", type: "inr", value: (r) => r.ytd.ty }),
      col<ConcernRowDto>({ key: "ytdLfl", label: "YTD LFL", type: "growth", value: (r) => growth(r.ytd) }),
      ...c.months.map((m, i) =>
        col<ConcernRowDto>({ key: `m${m}`, label: monthName(m), type: "growth", value: (r) => r.months[i]?.lfl ?? null, exportOnly: true })
      ),
    ],
  };
}

type BandRow = { key: string; label: string; stores: number; sales: { ty: number; ly: number }; area: number };

export function sqftBands(stores: StoreRowDto[]): BandRow[] {
  return SQFT_BANDS.map((band) => {
    const members = stores.filter((s) => s.sqft != null && s.sqft >= band.min && s.sqft < band.max);
    return {
      key: band.key,
      label: band.label,
      stores: members.length,
      sales: sumPair(members.map((s) => s.sales)),
      area: members.reduce((sum, s) => sum + (s.sqft ?? 0), 0),
    };
  });
}

export function sqftTable(d: LflDashboardDto): ReportTable<BandRow> {
  return {
    key: "sqft",
    title: REPORT_TITLES.sqft,
    description: "Sales per sq ft is for the selected range. Stores without a carpet area are left out.",
    rows: sqftBands(d.stores),
    rowKey: (r) => r.key,
    columns: [
      col<BandRow>({ key: "size", label: "Size", type: "text", value: (r) => r.label }),
      col<BandRow>({ key: "stores", label: "Stores", type: "int", value: (r) => r.stores }),
      col<BandRow>({ key: "perStore", label: "Sales / store", type: "inr", value: (r) => ratio(r.sales.ty, r.stores) }),
      col<BandRow>({ key: "perSqft", label: "Sales / sq ft", type: "inr", value: (r) => ratio(r.sales.ty, r.area) }),
      col<BandRow>({ key: "lfl", label: "Revenue LFL", type: "growth", value: (r) => growth(r.sales) }),
    ],
  };
}

/** The Stores tab: every store matching the filters, LFL and new. */
/** " · Closed · last sale 26 Apr 2026" / " · no sale since 31 Jul 2026"; empty for a trading store. */
export function storeState(s: StoreRowDto): string {
  const since = s.lastSaleOn ? new Date(`${s.lastSaleOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
  if (s.status === "Closed" && s.closedButSelling) return ` · marked Closed but still selling${since ? ` (last sale ${since})` : ""}`;
  if (s.status === "Closed") return ` · Closed${since ? ` · last sale ${since}` : ""}`;
  if (s.looksShut && since) return ` · no sale since ${since} (marked Live)`;
  return "";
}

export function storesTable(d: LflDashboardDto): ReportTable<StoreRowDto> {
  const hasStock = d.inventory.connected;
  const hasStaff = d.staff.connected;
  const conv = (s: StoreRowDto) => ratioPair(s.billsWithFootfall, s.footfall);
  return {
    key: "stores",
    title: REPORT_TITLES.stores,
    rows: d.allStores,
    rowKey: (s) => s.id,
    columns: [
      col<StoreRowDto>({
        key: "store",
        label: "Store",
        type: "text",
        value: (s) => s.name,
        sub: (s) => `${s.city} · ${s.am} · ${s.type}${s.isLfl ? "" : " · non-LFL"}${storeState(s)}`,
      }),
      col<StoreRowDto>({ key: "city", label: "City", type: "text", value: (s) => s.city, exportOnly: true }),
      col<StoreRowDto>({ key: "region", label: "Region", type: "text", value: (s) => s.region, exportOnly: true }),
      col<StoreRowDto>({ key: "am", label: "AM / CM", type: "text", value: (s) => s.am, exportOnly: true }),
      col<StoreRowDto>({ key: "age", label: "Store age", type: "text", value: (s) => s.age, exportOnly: true }),
      col<StoreRowDto>({ key: "type", label: "Store type", type: "text", value: (s) => s.type, exportOnly: true }),
      col<StoreRowDto>({ key: "lflFlag", label: "LFL", type: "text", value: (s) => (s.isLfl ? "LFL" : "Non-LFL"), exportOnly: true }),
      col<StoreRowDto>({ key: "status", label: "Status", type: "text", value: (s) => (s.closedButSelling ? "Marked Closed, still selling" : s.status === "Closed" ? "Closed" : s.looksShut ? "No recent sales" : s.status ?? ""), exportOnly: true }),
      col<StoreRowDto>({ key: "lastSale", label: "Last sale", type: "date", value: (s) => s.lastSaleOn, exportOnly: true }),
      col<StoreRowDto>({ key: "sqft", label: "Sq ft", type: "int", value: (s) => s.sqft }),
      col<StoreRowDto>({ key: "sales", label: "Sales TY", type: "inr", value: (s) => s.sales.ty }),
      col<StoreRowDto>({ key: "salesLy", label: "Sales LY", type: "inr", value: (s) => s.sales.ly, exportOnly: true }),
      col<StoreRowDto>({ key: "lfl", label: "LFL", type: "growth", value: (s) => growth(s.sales) }),
      col<StoreRowDto>({ key: "gold", label: "Gold LFL", type: "growth", value: (s) => growth(s.gold) }),
      col<StoreRowDto>({ key: "silver", label: "Silver LFL", type: "growth", value: (s) => growth(s.silver) }),
      col<StoreRowDto>({
        key: "dens",
        label: "Sales / sq ft",
        title: "Revenue per sq ft over the selected range",
        type: "inr",
        value: (s) => (s.sqft ? ratio(s.sales.ty, s.sqft) : null),
      }),
      col<StoreRowDto>({ key: "nob", label: "NOB", type: "int", value: (s) => s.bills.ty }),
      col<StoreRowDto>({ key: "nobLy", label: "NOB LY", type: "int", value: (s) => s.bills.ly, exportOnly: true }),
      col<StoreRowDto>({ key: "goldNob", label: "Gold NOB", type: "int", value: (s) => s.goldBills.ty }),
      col<StoreRowDto>({ key: "goldNobLy", label: "Gold NOB LY", type: "int", value: (s) => s.goldBills.ly, exportOnly: true }),
      col<StoreRowDto>({ key: "silverNob", label: "Silver NOB", type: "int", value: (s) => s.silverBills.ty }),
      col<StoreRowDto>({ key: "silverNobLy", label: "Silver NOB LY", type: "int", value: (s) => s.silverBills.ly, exportOnly: true }),
      col<StoreRowDto>({ key: "goldQty", label: "Gold qty", type: "int", value: (s) => s.goldUnits.ty, exportOnly: true }),
      col<StoreRowDto>({ key: "silverQty", label: "Silver qty", type: "int", value: (s) => s.silverUnits.ty, exportOnly: true }),
      col<StoreRowDto>({ key: "conv", label: "Conversion", type: "share", value: (s) => conv(s).ty }),
      col<StoreRowDto>({ key: "convChange", label: "Δ Conversion", type: "pts", value: (s) => pts(conv(s).ty, conv(s).ly), exportOnly: true }),
      ...(hasStock
        ? [
            col<StoreRowDto>({ key: "stock", label: "Stock", type: "int", value: (s) => s.inventory?.ty ?? null }),
            col<StoreRowDto>({ key: "invChange", label: "Δ Inventory", type: "growth", value: (s) => (s.inventory ? growth(s.inventory) : null) }),
          ]
        : []),
      ...(hasStaff
        ? [
            col<StoreRowDto>({
              key: "tenure",
              label: "Staff tenure",
              title: "Average tenure of active staff",
              type: "months",
              value: (s) => s.avgTenureMonths,
              sub: (s) => (s.staff ? `${s.staff} staff` : null),
            }),
            col<StoreRowDto>({ key: "staff", label: "Active staff", type: "int", value: (s) => s.staff, exportOnly: true }),
          ]
        : []),
    ],
  };
}

type InvRow = { key: string; label: string; ty: number; ly: number };

export function inventoryTable(d: LflDashboardDto, metal: MetalView): ReportTable<InvRow> {
  const rows = d.categories[metal]
    .filter((r) => r.inventory && r.inventory.ty + r.inventory.ly > 0)
    .map((r) => ({ key: r.key, label: r.label, ty: r.inventory!.ty, ly: r.inventory!.ly }));
  // Without a last-year count there's nothing to compare, so show stock alone.
  const hasLy = (d.inventory.total?.ly ?? 0) > 0;
  return {
    key: "inventory",
    title: `${REPORT_TITLES.inventory} · ${METAL_LABEL[metal]}`,
    description: d.inventory.asOf
      ? hasLy
        ? `Units on hand on ${d.inventory.asOf} vs ${d.inventory.lyAsOf}.`
        : `Units on hand on ${d.inventory.asOf}. No stock count from a year earlier yet, so there's no change to show.`
      : undefined,
    rows,
    total: { key: "total", label: "Total", ...sumPair(rows) },
    rowKey: (r) => r.key,
    columns: [
      col<InvRow>({ key: "category", label: "Category", type: "text", value: (r) => r.label }),
      col<InvRow>({ key: "ty", label: "Units on hand", type: "int", value: (r) => r.ty }),
      ...(hasLy
        ? [
            col<InvRow>({ key: "ly", label: "Last year", type: "int", value: (r) => r.ly }),
            col<InvRow>({ key: "change", label: "Δ Inventory", type: "growth", value: (r) => growthOf(r.ty, r.ly) }),
          ]
        : [])
    ],
  };
}

type TenureRow = { key: string; label: string; staff: number; stores: number; sales: { ty: number; ly: number } };

export function tenureTable(d: LflDashboardDto): ReportTable<TenureRow> {
  const rows = d.staff.lflByTenure.map((g) => ({
    ...g,
    staff: d.staff.bands.find((b) => b.key === g.key)?.staff ?? 0,
  }));
  return {
    key: "tenure",
    title: REPORT_TITLES.tenure,
    description: "Staff = people whose own tenure is in the band. Stores = stores whose team average is in the band.",
    rows,
    rowKey: (r) => r.key,
    columns: [
      col<TenureRow>({ key: "band", label: "Tenure", type: "text", value: (r) => r.label }),
      col<TenureRow>({ key: "staff", label: "Staff", type: "int", value: (r) => r.staff }),
      col<TenureRow>({ key: "stores", label: "Stores (team avg)", type: "int", value: (r) => r.stores }),
      col<TenureRow>({ key: "lfl", label: "Revenue LFL", type: "growth", value: (r) => growth(r.sales) }),
    ],
  };
}

/** Sales per salesperson in the range, with role and tenure from the HR register. */
export function staffSalesTable(d: LflDashboardDto): ReportTable<StaffSalesRowDto> {
  return {
    key: "staffsales",
    title: REPORT_TITLES.staffsales,
    description: "Sales are credited to the staff member on each order. Tenure and role come from the HR register.",
    rows: d.staff.sales,
    rowKey: (r) => `${r.storeId}|${r.id}`,
    columns: [
      col<StaffSalesRowDto>({ key: "name", label: "Staff", type: "text", value: (r) => r.name, sub: (r) => [r.storeName, r.role].filter(Boolean).join(" · ") }),
      col<StaffSalesRowDto>({ key: "id", label: "Staff ID", type: "text", value: (r) => r.id, exportOnly: true }),
      col<StaffSalesRowDto>({ key: "store", label: "Store", type: "text", value: (r) => r.storeName, exportOnly: true }),
      col<StaffSalesRowDto>({ key: "role", label: "Role", type: "text", value: (r) => r.role, exportOnly: true }),
      col<StaffSalesRowDto>({ key: "tenure", label: "Tenure", type: "months", value: (r) => r.tenureMonths }),
      col<StaffSalesRowDto>({ key: "sales", label: "Sales", type: "inr", value: (r) => r.sales }),
      col<StaffSalesRowDto>({ key: "gold", label: "Gold share", type: "share", value: (r) => ratio(r.gold, r.sales) }),
      col<StaffSalesRowDto>({ key: "bills", label: "Bills", type: "int", value: (r) => r.bills }),
      col<StaffSalesRowDto>({ key: "aov", label: "Avg bill", title: "Sales per bill", type: "inr", value: (r) => ratio(r.sales, r.bills) }),
      col<StaffSalesRowDto>({ key: "days", label: "Selling days", type: "int", value: (r) => r.days }),
      col<StaffSalesRowDto>({ key: "perDay", label: "Sales / day", title: "Sales per day with a sale", type: "inr", value: (r) => ratio(r.sales, r.days) }),
    ],
  };
}

type TenureSalesRow = TenureSalesDto["bands"][number];

export function tenureSalesTable(d: LflDashboardDto): ReportTable<TenureSalesRow> {
  const t = d.staff.tenureVsSales;
  return {
    key: "tenuresales",
    title: REPORT_TITLES.tenuresales,
    description: t
      ? `${t.role}' monthly sales by tenure, ${t.months.length} full month${t.months.length === 1 ? "" : "s"}. Only people employed the whole month count.`
      : "Needs staff sales and HR registers.",
    rows: t?.bands ?? [],
    rowKey: (r) => r.key,
    columns: [
      col<TenureSalesRow>({ key: "band", label: "Tenure", type: "text", value: (r) => r.label }),
      col<TenureSalesRow>({ key: "people", label: "Person-months", type: "int", value: (r) => r.staffMonths }),
      col<TenureSalesRow>({ key: "sales", label: "Median sales / month", type: "inr", value: (r) => (r.staffMonths ? r.medianSales : null) }),
      col<TenureSalesRow>({ key: "bills", label: "Median bills / month", type: "int", value: (r) => (r.staffMonths ? r.medianBills : null) }),
    ],
  };
}

/** Every dashboard report, for the given metal view of the category reports. */
export function dashboardReports(d: LflDashboardDto, metal: MetalView = "all"): Record<ReportKey, AnyReportTable> {
  return {
    summary: summaryTable(d),
    trend: trendTable("trend", REPORT_TITLES.trend, d.trend.points),
    metals: metalsTable(d),
    regions: regionsTable(d),
    subregions: subregionsTable(d),
    cities: citiesTable(d),
    ages: agesTable(d),
    ams: amsTable(d),
    concerns: concernsTable(d),
    sqft: sqftTable(d),
    gold: segmentTable("gold", REPORT_TITLES.gold, d.gold),
    silver: segmentTable("silver", REPORT_TITLES.silver, d.silver),
    categories: categoryTable(
      "categories",
      `${REPORT_TITLES.categories} · ${METAL_LABEL[metal]}`,
      d.categories[metal],
      d.inventory.connected,
      "Δ Category is the change in share of revenue, in percentage points. Avg selling price is revenue per unit sold."
    ),
    stores: storesTable(d),
    inventory: inventoryTable(d, metal),
    tenure: tenureTable(d),
    staffsales: staffSalesTable(d),
    tenuresales: tenureSalesTable(d),
  };
}
