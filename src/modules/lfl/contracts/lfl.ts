import { z } from "zod";

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Carpet-area bands for the sq ft filter. */
export const SQFT_BANDS = [
  { key: "lt300", label: "Under 300 sq ft", min: 0, max: 300 },
  { key: "300-500", label: "300 to 500 sq ft", min: 300, max: 500 },
  { key: "500-800", label: "500 to 800 sq ft", min: 500, max: 800 },
  { key: "800+", label: "800 sq ft +", min: 800, max: Number.POSITIVE_INFINITY },
] as const;
export type SqftBandKey = (typeof SQFT_BANDS)[number]["key"];

export const GOLD_SEGMENTS = [
  { key: "9KT", label: "9 Kt" },
  { key: "14KT", label: "14 Kt" },
  { key: "18KT", label: "18 Kt" },
  { key: "22KT", label: "22 Kt +" },
] as const;

export const SILVER_SEGMENTS = [
  { key: "CLASSIC", label: "Classic" },
  { key: "NON_CLASSIC", label: "Non-classic" },
] as const;

export const TENURE_BANDS = [
  { key: "lt3", label: "Under 3 months", min: 0, max: 3 },
  { key: "3-6", label: "3 to 6 months", min: 3, max: 6 },
  { key: "6-12", label: "6 to 12 months", min: 6, max: 12 },
  { key: "12-24", label: "1 to 2 years", min: 12, max: 24 },
  { key: "24+", label: "2 years +", min: 24, max: Number.POSITIVE_INFINITY },
] as const;

export const TREND_GRAINS = ["D", "W", "M"] as const;
export type TrendGrain = (typeof TREND_GRAINS)[number];

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value ? value : undefined));

export const LflFiltersSchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    region: optionalText,
    /** GIVA's sub-regions (N1, N2, S1, S2, W1, W2, East), from the region-split model. */
    subregion: optionalText,
    city: optionalText,
    am: optionalText,
    age: optionalText,
    type: optionalText,
    sqft: z
      .enum(SQFT_BANDS.map((band) => band.key) as [SqftBandKey, ...SqftBandKey[]])
      .optional(),
    grain: z.enum(TREND_GRAINS).default("W"),
    /** Concern stores look at calendar YTD (Jan–) or financial YTD (Apr–), whatever the date range. */
    concernBasis: z.enum(["ytd", "fytd"]).default("ytd"),
    /** LFL stores only (open across both periods). On by default. */
    lflOnly: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .default(true)
      .transform((value) => value === true || value === "true"),
    /**
     * Compare against these dates instead of the same dates a year earlier:
     * a festival (Diwali 2026 vs Diwali 2025, which fall on different days) or
     * any custom window. It must end before this year's starts.
     */
    lyFrom: IsoDateSchema.optional(),
    lyTo: IsoDateSchema.optional(),
    /** The festival preset that set the dates (see components/festivals.ts); a label only. */
    festival: optionalText,
    /** Leave out stores the store master marks Closed, from both years. Off by default (#8734 keeps them). */
    excludeClosed: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .default(false)
      .transform((value) => value === true || value === "true"),
  })
  .refine((value) => value.from <= value.to, {
    message: "From date must be on or before To date",
    path: ["from"],
  })
  .refine((value) => !value.lyFrom === !value.lyTo, { message: "Give both comparison dates or neither", path: ["lyFrom"] })
  .refine((value) => !value.lyFrom || !value.lyTo || value.lyFrom <= value.lyTo, {
    message: "Comparison From date must be on or before its To date",
    path: ["lyFrom"],
  })
  .refine((value) => !value.lyFrom || !value.lyTo || value.lyTo < value.from, {
    message: "The comparison dates must end before this year's dates start",
    path: ["lyTo"],
  })
  .refine((value) => !value.lyFrom || !value.lyTo || (Date.parse(value.lyTo) - Date.parse(value.lyFrom)) / 86_400_000 < 365, {
    message: "Pick a comparison range shorter than one year",
    path: ["lyTo"],
  })
  // Longer ranges would overlap their own last-year window.
  .refine(
    (value) =>
      (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 < 365,
    { message: "Pick a range shorter than one year", path: ["to"] }
  );
export type LflFiltersInput = z.input<typeof LflFiltersSchema>;
export type LflFilters = z.output<typeof LflFiltersSchema>;

/**
 * Where the board's numbers come from: made-up sample stores; BigQuery feeds
 * loaded into the app database on a schedule; or the same SQL run live in
 * BigQuery with no app database.
 */
export type DataSource = "sample" | "bigquery" | "bigquery-live";

/** This-year vs last-year pair. Growth is derived where it is displayed. */
export type Pair = { ty: number; ly: number };

/**
 * Silver bills and per-metal units and line sales, as in "LFL Metrics Main"
 * (#8734): S_NOB, G_qty / S_qty, and the G_sales / S_sales its ASP divides by
 * quantity (sale lines before exchanges, returns and promo).
 */
export type MetalCounts = {
  silverBills: Pair;
  goldUnits: Pair;
  silverUnits: Pair;
  goldLineSales: Pair;
  silverLineSales: Pair;
  /** Gold made-to-order (orders in mto_orders_new, billed in store). */
  goldMtoSales: Pair;
  goldMtoBills: Pair;
  goldMtoUnits: Pair;
  goldMtoLineSales: Pair;
};

export type SegmentRowDto = {
  key: string;
  label: string;
  sales: Pair;
  units: Pair;
};

export type CategoryRowDto = {
  key: string;
  label: string;
  sales: Pair;
  units: Pair;
  /** Units on hand at the end of each period; null when inventory isn't connected. */
  inventory: Pair | null;
};

export type StoreRowDto = {
  id: string;
  name: string;
  city: string;
  subregion: string;
  /** Metro group the city view uses (one of CITY_GROUPS, or Rest of India). */
  cityGroup: string;
  region: string;
  am: string;
  age: string;
  type: string;
  sqft: number | null;
  /** First order (or live date): the store's age. */
  openedOn: string | null;
  /** Store master status ("Live", "Closed"), when known. */
  status: string | null;
  /** Last billed day, when known. */
  lastSaleOn: string | null;
  /** Not marked Closed, but no sale for 30+ days before the period end: possibly shut. */
  looksShut: boolean;
  /** Marked Closed in the store master but billed in the last 30 days: the flag is probably wrong. */
  closedButSelling: boolean;
  /** Store position from the store master, when known. */
  lat: number | null;
  lng: number | null;
  isLfl: boolean;
  sales: Pair;
  gold: Pair;
  silver: Pair;
  bills: Pair;
  goldBills: Pair;
  footfall: Pair;
  billsWithFootfall: Pair;
  inventory: Pair | null;
  staff: number | null;
  avgTenureMonths: number | null;
} & MetalCounts;

export type TrendPointDto = {
  start: string;
  label: string;
  sales: Pair;
  gold: Pair;
  silver: Pair;
};

export type GroupRowDto = {
  key: string;
  stores: number;
  sales: Pair;
  gold: Pair;
  silver: Pair;
  bills: Pair;
  goldBills: Pair;
  silverBills: Pair;
  footfall: Pair;
  /** Bills on days with counted footfall: the numerator of conversion. */
  billsWithFootfall: Pair;
  /** Stores with sales this year / last year: the divisor for per-store numbers. */
  trading: Pair;
  /** Units sold (SKU quantity); null when the source has no unit counts. */
  units: Pair | null;
  /** False when last year isn't a fair base (stores under 12 months old): LFL shows as a dash. */
  comparable?: boolean;
};

/** Metro groups used by the city view, in display order; everything else is Rest of India. */
export const CITY_GROUPS = ["Delhi NCR", "Bengaluru", "Hyderabad", "Mumbai", "Pune", "Chennai", "Kolkata", "Ahmedabad"] as const;
export const REST_OF_INDIA = "Rest of India";

export type ConcernRowDto = {
  id: string;
  name: string;
  city: string;
  region: string;
  am: string;
  age: string;
  type: string;
  /** Revenue LFL per month of the year so far; null where there's no last-year base. */
  months: { month: string; sales: Pair; lfl: number | null }[];
  degrowingMonths: number;
  ytd: Pair;
};

export type LflDashboardDto = {
  meta: {
    from: string;
    to: string;
    lyFrom: string;
    lyTo: string;
    source: DataSource;
    generatedAt: string;
    storeCount: number;
    notes: string[];
  };
  options: {
    regions: string[];
    subregions: string[];
    cities: string[];
    ams: string[];
    ages: string[];
    types: string[];
  };
  totals: {
    sales: Pair;
    gold: Pair;
    silver: Pair;
    bills: Pair;
    goldBills: Pair;
    footfall: Pair;
    /** Bills on days with counted footfall; conversion = this ÷ footfall (as in LFL Metrics Main #8734). */
    billsWithFootfall: Pair;
    /** Stores trading in each period, used for per-store averages. */
    stores: Pair;
  } & MetalCounts;
  trend: { grain: TrendGrain; points: TrendPointDto[] };
  regions: GroupRowDto[];
  subregions: GroupRowDto[];
  /** Metro groups plus Rest of India; follows the LFL toggle. */
  cities: GroupRowDto[];
  /** Store-age buckets over all stores, LFL or not. */
  ages: GroupRowDto[];
  /** Area managers, for rankings. */
  ams: GroupRowDto[];
  /** Stores degrowing month by month this year (ignores the date range, follows other filters). */
  concerns: { basis: "ytd" | "fytd"; from: string; to: string; months: string[]; rows: ConcernRowDto[] };
  gold: SegmentRowDto[];
  silver: SegmentRowDto[];
  /** Gold and silver side by side: sales (as the KPIs), units from the karat / category feed. */
  /**
   * Sales, units and ASP per metal. Units and line sales come from the daily
   * feed (as #8734); older data without them falls back to karat / category units.
   */
  metals: { key: "gold" | "gold-stock" | "gold-mto" | "silver"; label: string; sales: Pair; units: Pair | null; lineSales: Pair | null; bills?: Pair; sub?: boolean }[];
  categories: {
    all: CategoryRowDto[];
    gold: CategoryRowDto[];
    silver: CategoryRowDto[];
  };
  /** False when the source has no karat / classic / category split. */
  mix: { connected: boolean };
  inventory: {
    connected: boolean;
    asOf: string | null;
    lyAsOf: string | null;
    total: Pair | null;
  };
  staff: {
    connected: boolean;
    headcount: number;
    avgTenureMonths: number | null;
    bands: { key: string; label: string; staff: number }[];
    /** Stores grouped by their average staff tenure, with the group's revenue LFL. */
    lflByTenure: { key: string; label: string; stores: number; sales: Pair }[];
    /** Active staff by designation, when the source has designations. */
    roles: { role: string; staff: number; avgTenureMonths: number }[];
    /** Month by month for the stores in view (HR registers): headcount at month end, joiners, leavers. */
    monthly: { month: string; headcount: number; joined: number; left: number }[];
    /** Sales per salesperson in the date range (POS staff on each order), linked to the HR register where possible. */
    sales: StaffSalesRowDto[];
    /** Do longer-serving consultants sell more? Null without both sales and registers. */
    tenureVsSales: TenureSalesDto | null;
  };
  /** Stores in the LFL view (follows the toggle). */
  stores: StoreRowDto[];
  /** Every store matching the filters, LFL and new, for the Stores tab. */
  allStores: StoreRowDto[];
};

export const StoreDetailInputSchema = z.object({
  storeId: z.string().trim().min(1).max(64),
});

export type StaffSalesRowDto = {
  /** POS staff id. */
  id: string;
  name: string;
  storeId: string;
  storeName: string;
  /** From the HR register, when the salesperson is on it. */
  employeeNo: string | null;
  role: string | null;
  tenureMonths: number | null;
  sales: number;
  gold: number;
  bills: number;
  units: number;
  /** Days with at least one sale. */
  days: number;
};

export type TenureSalesDto = {
  role: string;
  /** Full months the analysis uses, YYYY-MM-01. */
  months: string[];
  /** Person-months counted (people employed for the whole month). */
  staffMonths: number;
  bands: { key: string; label: string; staffMonths: number; medianSales: number; medianBills: number }[];
  /** By month of tenure: 1 = first full month … "12+" = a year or more. */
  byTenureMonth: { month: number; label: string; staffMonths: number; medianSales: number }[];
  /** Rank correlation between tenure and monthly sales, -1 to 1. */
  correlation: number | null;
  /** Same store, same month: pairs compared and how often the longer-serving one sold more. */
  pairs: number;
  longerWinsShare: number | null;
};

export type StaffMemberDto = {
  id: string;
  name: string | null;
  role: string | null;
  startedOn: string;
  leftOn: string | null;
  tenureMonths: number;
  active: boolean;
  /** Sales and bills in the date range, when staff sales are connected. */
  sales: number | null;
  bills: number | null;
  /** False for someone who billed in this store but isn't on its HR register (e.g. covering from another store). */
  onRegister: boolean;
};

/** A comparison group for the store: its region and everything in view. */
export type PeerGroupDto = {
  key: "region" | "all";
  label: string;
  stores: number;
  sales: Pair;
  bills: Pair;
  billsWithFootfall: Pair;
  footfall: Pair;
  /** Total carpet area of stores in the group that have one, and their sales. */
  sqft: number;
  salesWithArea: number;
};

export type StoreDetailDto = {
  meta: LflDashboardDto["meta"];
  store: {
    id: string;
    name: string;
    city: string;
    region: string;
    am: string;
    age: string;
    type: string;
    sqft: number | null;
    isLfl: boolean;
    firstSaleOn: string | null;
    status: string | null;
    lastSaleOn: string | null;
  };
  totals: Omit<LflDashboardDto["totals"], "stores">;
  /** Position among the stores in view (1 = best); null when not in view. */
  rank: { bySales: number | null; byLfl: number | null; of: number };
  peers: PeerGroupDto[];
  trend: LflDashboardDto["trend"];
  mix: LflDashboardDto["mix"];
  gold: SegmentRowDto[];
  silver: SegmentRowDto[];
  categories: LflDashboardDto["categories"];
  inventory: LflDashboardDto["inventory"];
  staff: { connected: boolean; members: StaffMemberDto[] };
};

/** Everything a viewer can download. Each maps to one table or sheet. */
export const REPORT_KEYS = [
  "summary",
  "trend",
  "metals",
  "regions",
  "subregions",
  "cities",
  "ages",
  "ams",
  "concerns",
  "sqft",
  "gold",
  "silver",
  "categories",
  "stores",
  "inventory",
  "tenure",
  "staffsales",
  "tenuresales",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const STORE_REPORT_KEYS = [
  "store-summary",
  "store-trend",
  "store-gold",
  "store-silver",
  "store-categories",
  "store-staff",
] as const;
export type StoreReportKey = (typeof STORE_REPORT_KEYS)[number];

export const ExportInputSchema = z.object({
  /** One report, or "all" for a workbook with every report as a sheet. */
  report: z.enum(["all", ...REPORT_KEYS, ...STORE_REPORT_KEYS]).default("all"),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  /** Category reports: which metal to show. */
  metal: z.enum(["all", "gold", "silver"]).default("all"),
  /** Set for store reports; "all" then means every store report. */
  store: z.string().trim().min(1).max(64).optional(),
});
export type ExportInput = z.output<typeof ExportInputSchema>;

/* ---------- Data feeds admin ---------- */

export type ImportRunDto = {
  id: string;
  dataset: string;
  source: string;
  label: string | null;
  status: string;
  rows: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type CarpetRowDto = {
  storeName: string;
  city: string | null;
  type: string | null;
  status: string | null;
  sqft: number | null;
};

export type AdminStatusDto = {
  source: DataSource;
  /** cards: saved question per feed, or null when the app's built-in SQL runs. */
  /** The BigQuery feed: credentials set, project / location, schedule. */
  feed: { configured: boolean; project: string | null; location: string | null; everyMinutes: number | null };
  coverage: {
    dailyFrom: string | null;
    dailyTo: string | null;
    dailyStores: number;
    stores: number;
    liveStores: number;
    storesWithArea: number;
    inventoryAsOf: string | null;
  };
  feeds: { dataset: string; label: string; lastOk: ImportRunDto | null; lastRun: ImportRunDto | null }[];
  runs: ImportRunDto[];
  carpet: CarpetRowDto[];
  /** Carpet sheet names that match no store in the store list. */
  unmatchedCarpet: string[];
  staff: {
    /** Register months loaded, YYYY-MM-01, newest first. */
    months: string[];
    /** Every HR branch on the latest register, with its store link. */
    branches: BranchLinkDto[];
    /** Stores for the link picker. */
    stores: { key: string; name: string; city: string | null }[];
  };
};

export type BranchLinkDto = {
  branch: string;
  city: string | null;
  /** People on the latest register for this branch. */
  staff: number;
  storeKey: string | null;
  storeName: string | null;
  /** exact / name (automatic), manual (set by a person), none (no match yet). */
  method: string;
};

export const UploadDatasetSchema = z.enum(["daily", "segments", "stores", "inventory", "carpet", "staff", "staffmap"]);

export const BranchLinkUpdateSchema = z.object({
  branch: z.string().trim().min(1).max(200),
  /** Null: this branch isn't a store (head office, training, …). */
  storeKey: z.string().trim().min(1).max(200).nullable(),
});

export const CarpetUpdateSchema = z.object({
  storeName: z.string().trim().min(1).max(200),
  sqft: z.number().int().positive().max(100_000).nullable(),
});

export const SyncRequestSchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

/** "Ask the data": a question about the current view, with the recent conversation. */
export const AskInputSchema = z.object({
  question: z.string().trim().min(1).max(600),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(10)
    .default([]),
});
export type AskInput = z.infer<typeof AskInputSchema>;
export type AskStatusDto = { enabled: boolean };
export type AskAnswerDto = {
  answer: string;
  /** Queries the AI ran to answer (Claude only), shown under the answer. */
  queries?: { purpose: string; sql: string; rows: number | null; error: string | null }[];
};
