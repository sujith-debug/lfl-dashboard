import "server-only";

import { normName } from "../services/lfl.service";
import type { RawRow } from "./table-reader";

/**
 * Column mappings for each feed. Headers are matched ignoring case, spaces
 * and punctuation, so "AM/CM", "AM_CM" and "am cm" are the same column.
 */

export const DATASETS = ["daily", "segments", "stores", "inventory", "carpet", "staff", "staffmap", "staffsales"] as const;
export type Dataset = (typeof DATASETS)[number];

export const DATASET_LABELS: Record<Dataset, string> = {
  daily: "LFL daily (store × day, TY and LY)",
  segments: "Karat / classic / category sales",
  stores: "Store details (master list)",
  inventory: "Stock on hand (SKU store-wise)",
  carpet: "Carpet area (sq ft)",
  staff: "Staff register (HR pay register, one month)",
  staffmap: "Staff branch → store links",
  staffsales: "Sales per salesperson (store × day)",
};

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

type FieldSpec = { aliases: string[]; required?: boolean };

/** Resolves each field to the file's header name, or reports what's missing. */
export function resolveColumns<F extends string>(
  headers: string[],
  spec: Record<F, FieldSpec>
): { columns: Record<F, string | null>; missing: F[] } {
  const byKey = new Map(headers.map((h) => [key(h), h]));
  const columns = {} as Record<F, string | null>;
  const missing: F[] = [];
  for (const field of Object.keys(spec) as F[]) {
    const hit = spec[field].aliases.map((a) => byKey.get(key(a))).find((h) => h !== undefined) ?? null;
    columns[field] = hit;
    if (!hit && spec[field].required) missing.push(field);
  }
  return { columns, missing };
}

export function toNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/[,%₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function toText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s && s !== "#VALUE!" && s !== "#N/A" ? s : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A calendar day as YYYY-MM-DD from the forms BigQuery exports and Excel produce:
 * 2026-04-01, 2026-04-01 00:00:00, 20260401, 01/04/2026, or "01-Apr" plus a year.
 */
export function toIsoDate(value: unknown, year?: unknown): string | null {
  const iso = parseIsoDate(value, year);
  if (!iso) return null;
  // Reject impossible days like 2026-02-31 rather than letting them fail later.
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseIsoDate(value: unknown, year?: unknown): string | null {
  if (value == null || value === "") return null;
  // Excel serial day numbers (1900 system): 45000 is 2023-03-15.
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*(?:[-\s,]+(\d{2,4}))?$/);
  if (m && MONTHS[m[2]!.toLowerCase()]) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Math.round(toNumber(year));
    if (!y) return null;
    return `${y}-${pad(MONTHS[m[2]!.toLowerCase()]!)}-${pad(Number(m[1]))}`;
  }
  return null;
}

/* ---------- LFL daily ---------- */

export const DAILY_FIELDS = {
  period: { aliases: ["D_W_M_Q", "date", "day", "order_date"], required: true },
  year: { aliases: ["Year"] },
  store: { aliases: ["location_name", "store_name", "store", "Store Name"], required: true },
  region: { aliases: ["Region"] },
  am: { aliases: ["AM_CM", "AM/CM", "am"] },
  city: { aliases: ["City"] },
  ageBucket: { aliases: ["Age_Bucket", "age"] },
  cohort: { aliases: ["Cohort"] },
  lflFlag: { aliases: ["LFL_Flag"] },
  firstOrderDate: { aliases: ["First_order_date", "first_order_date"] },
  tySales: { aliases: ["TY_Net_sales_after_ERDP", "TY_Net_sales"], required: true },
  lySales: { aliases: ["LY_Net_sales_after_ERDP", "LY_Net_sales"], required: true },
  tyGold: { aliases: ["TY_G_sales_after_ERDP", "TY_G_sales"] },
  lyGold: { aliases: ["LY_G_sales_after_ERDP", "LY_G_sales"] },
  tySilver: { aliases: ["TY_S_sales_after_ERDP", "TY_S_sales"] },
  lySilver: { aliases: ["LY_S_sales_after_ERDP", "LY_S_sales"] },
  tyBills: { aliases: ["TY_NOB"] },
  lyBills: { aliases: ["LY_NOB"] },
  tyGoldBills: { aliases: ["TY_G_NOB"] },
  lyGoldBills: { aliases: ["LY_G_NOB"] },
  tyFootfall: { aliases: ["TY_FF", "TY_Footfall"] },
  lyFootfall: { aliases: ["LY_FF", "LY_Footfall"] },
  tySilverBills: { aliases: ["TY_S_NOB"] },
  lySilverBills: { aliases: ["LY_S_NOB"] },
  tyGoldUnits: { aliases: ["TY_G_qty"] },
  lyGoldUnits: { aliases: ["LY_G_qty"] },
  tySilverUnits: { aliases: ["TY_S_qty"] },
  lySilverUnits: { aliases: ["LY_S_qty"] },
  tyGoldLineSales: { aliases: ["TY_G_line_sales"] },
  lyGoldLineSales: { aliases: ["LY_G_line_sales"] },
  tySilverLineSales: { aliases: ["TY_S_line_sales"] },
  lySilverLineSales: { aliases: ["LY_S_line_sales"] },
  tyGoldMtoSales: { aliases: ["TY_G_MTO_sales"] },
  lyGoldMtoSales: { aliases: ["LY_G_MTO_sales"] },
  tyGoldMtoBills: { aliases: ["TY_G_MTO_NOB"] },
  lyGoldMtoBills: { aliases: ["LY_G_MTO_NOB"] },
  tyGoldMtoUnits: { aliases: ["TY_G_MTO_qty"] },
  lyGoldMtoUnits: { aliases: ["LY_G_MTO_qty"] },
  tyGoldMtoLineSales: { aliases: ["TY_G_MTO_line_sales"] },
  lyGoldMtoLineSales: { aliases: ["LY_G_MTO_line_sales"] },
} satisfies Record<string, FieldSpec>;

export type DailyRow = {
  storeKey: string;
  storeName: string;
  date: string;
  region: string | null;
  am: string | null;
  city: string | null;
  ageBucket: string | null;
  cohort: string | null;
  lflFlag: string | null;
  firstOrderDate: string | null;
  tySales: number;
  lySales: number;
  tyGold: number;
  lyGold: number;
  tySilver: number;
  lySilver: number;
  tyBills: number;
  lyBills: number;
  tyGoldBills: number;
  lyGoldBills: number;
  tyFootfall: number;
  lyFootfall: number;
  tySilverBills: number;
  lySilverBills: number;
  tyGoldUnits: number;
  lyGoldUnits: number;
  tySilverUnits: number;
  lySilverUnits: number;
  tyGoldLineSales: number;
  lyGoldLineSales: number;
  tySilverLineSales: number;
  lySilverLineSales: number;
  tyGoldMtoSales: number;
  lyGoldMtoSales: number;
  tyGoldMtoBills: number;
  lyGoldMtoBills: number;
  tyGoldMtoUnits: number;
  lyGoldMtoUnits: number;
  tyGoldMtoLineSales: number;
  lyGoldMtoLineSales: number;
};

/** Null when the row isn't a single day (e.g. a week or month total) or has no store. */
export function mapDaily(row: RawRow, c: Record<keyof typeof DAILY_FIELDS, string | null>): DailyRow | null {
  const get = (f: keyof typeof DAILY_FIELDS) => (c[f] ? row[c[f]!] : null);
  const date = toIsoDate(get("period"), get("year"));
  const storeName = toText(get("store"));
  if (!date || !storeName) return null;
  const n = (f: keyof typeof DAILY_FIELDS) => toNumber(get(f));
  const tySales = n("tySales");
  const lySales = n("lySales");
  const tyGold = n("tyGold");
  const lyGold = n("lyGold");
  return {
    storeKey: normName(storeName),
    storeName,
    date,
    region: toText(get("region")),
    am: toText(get("am")),
    city: toText(get("city")),
    ageBucket: toText(get("ageBucket")),
    cohort: toText(get("cohort")),
    lflFlag: toText(get("lflFlag")),
    firstOrderDate: toIsoDate(get("firstOrderDate")),
    tySales,
    lySales,
    tyGold,
    lyGold,
    // When silver isn't sent, it's whatever isn't gold.
    tySilver: c.tySilver ? n("tySilver") : tySales - tyGold,
    lySilver: c.lySilver ? n("lySilver") : lySales - lyGold,
    tyBills: n("tyBills"),
    lyBills: n("lyBills"),
    tyGoldBills: n("tyGoldBills"),
    lyGoldBills: n("lyGoldBills"),
    tyFootfall: n("tyFootfall"),
    lyFootfall: n("lyFootfall"),
    // Older exports and uploads don't carry these; they load as 0 and the board falls back.
    tySilverBills: n("tySilverBills"),
    lySilverBills: n("lySilverBills"),
    tyGoldUnits: n("tyGoldUnits"),
    lyGoldUnits: n("lyGoldUnits"),
    tySilverUnits: n("tySilverUnits"),
    lySilverUnits: n("lySilverUnits"),
    tyGoldLineSales: n("tyGoldLineSales"),
    lyGoldLineSales: n("lyGoldLineSales"),
    tySilverLineSales: n("tySilverLineSales"),
    lySilverLineSales: n("lySilverLineSales"),
    tyGoldMtoSales: n("tyGoldMtoSales"),
    lyGoldMtoSales: n("lyGoldMtoSales"),
    tyGoldMtoBills: n("tyGoldMtoBills"),
    lyGoldMtoBills: n("lyGoldMtoBills"),
    tyGoldMtoUnits: n("tyGoldMtoUnits"),
    lyGoldMtoUnits: n("lyGoldMtoUnits"),
    tyGoldMtoLineSales: n("tyGoldMtoLineSales"),
    lyGoldMtoLineSales: n("lyGoldMtoLineSales"),
  };
}

/* ---------- Karat / classic / category ---------- */

export const SEGMENT_FIELDS = {
  date: { aliases: ["date", "D_W_M_Q"], required: true },
  store: { aliases: ["location_name", "store_name", "Store Name"], required: true },
  metal: { aliases: ["metal"], required: true },
  segment: { aliases: ["segment", "karat", "collection"], required: true },
  category: { aliases: ["category"] },
  tySales: { aliases: ["TY_sales"], required: true },
  lySales: { aliases: ["LY_sales"], required: true },
  tyUnits: { aliases: ["TY_units"] },
  lyUnits: { aliases: ["LY_units"] },
} satisfies Record<string, FieldSpec>;

export type SegmentRow = {
  storeKey: string;
  date: string;
  metal: "GOLD" | "SILVER";
  segment: string;
  category: string;
  tySales: number;
  lySales: number;
  tyUnits: number;
  lyUnits: number;
};

export function mapSegment(row: RawRow, c: Record<keyof typeof SEGMENT_FIELDS, string | null>): SegmentRow | null {
  const get = (f: keyof typeof SEGMENT_FIELDS) => (c[f] ? row[c[f]!] : null);
  const date = toIsoDate(get("date"));
  const store = toText(get("store"));
  const metal = toText(get("metal"))?.toUpperCase();
  if (!date || !store || !metal) return null;
  return {
    storeKey: normName(store),
    date,
    metal: metal.startsWith("G") ? "GOLD" : "SILVER",
    segment: toText(get("segment"))?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") ?? "UNMAPPED",
    category: toText(get("category")) ?? "Other",
    tySales: toNumber(get("tySales")),
    lySales: toNumber(get("lySales")),
    tyUnits: toNumber(get("tyUnits")),
    lyUnits: toNumber(get("lyUnits")),
  };
}

/* ---------- Store details ---------- */

export const STORE_FIELDS = {
  name: { aliases: ["Store Name", "location_name", "store_name", "store"], required: true },
  code: { aliases: ["Store code", "store_code"] },
  locationId: { aliases: ["location_id", "Store Id", "store_id"] },
  region: { aliases: ["Region"] },
  subregion: { aliases: ["Subregion", "sub_region"] },
  city: { aliases: ["City"] },
  state: { aliases: ["State"] },
  am: { aliases: ["AM/CM", "AM_CM", "am"] },
  type: { aliases: ["Type", "store type", "store_type", "format"] },
  status: { aliases: ["Live status", "status"] },
  liveDate: { aliases: ["Live Date", "live_date", "opening_date", "open_date"] },
  closeDate: { aliases: ["Close Date", "close_date"] },
  firstOrderDate: { aliases: ["First_order_date", "first_order_date"] },
  lastSaleDate: { aliases: ["Last_sale_date", "last_sale_date", "Last sale"] },
  ownership: { aliases: ["Ownership", "ownership"] },
  latitude: { aliases: ["Latitude", "lat"] },
  longitude: { aliases: ["Longitude", "lng", "lon"] },
} satisfies Record<string, FieldSpec>;

export type StoreRow = {
  key: string;
  name: string;
  code: string | null;
  locationId: string | null;
  region: string | null;
  subregion: string | null;
  city: string | null;
  state: string | null;
  am: string | null;
  storeType: string | null;
  status: string | null;
  liveDate: string | null;
  closeDate: string | null;
  firstOrderDate: string | null;
  lastSaleDate: string | null;
  ownership: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** A latitude / longitude inside India's box, else null (blank or swapped values). */
function coordinate(value: unknown, min: number, max: number): number | null {
  if (value == null || value === "") return null;
  const n = toNumber(value);
  return n >= min && n <= max ? n : null;
}

export function mapStore(row: RawRow, c: Record<keyof typeof STORE_FIELDS, string | null>): StoreRow | null {
  const get = (f: keyof typeof STORE_FIELDS) => (c[f] ? row[c[f]!] : null);
  const name = toText(get("name"));
  if (!name) return null;
  const locationId = toText(get("locationId"));
  const status = toText(get("status"));
  return {
    key: normName(name),
    name,
    code: toText(get("code")),
    locationId: locationId && /^\d+(\.0)?$/.test(locationId) ? locationId.replace(/\.0$/, "") : null,
    region: toText(get("region")),
    subregion: toText(get("subregion")),
    city: toText(get("city")),
    state: toText(get("state")),
    am: toText(get("am")),
    storeType: toText(get("type")),
    status: status ? status[0]!.toUpperCase() + status.slice(1).toLowerCase() : null,
    liveDate: toIsoDate(get("liveDate")),
    closeDate: toIsoDate(get("closeDate")),
    firstOrderDate: toIsoDate(get("firstOrderDate")),
    lastSaleDate: toIsoDate(get("lastSaleDate")),
    ownership: toText(get("ownership")),
    latitude: coordinate(get("latitude"), 5, 40),
    longitude: coordinate(get("longitude"), 65, 100),
  };
}

/* ---------- Stock ---------- */

export const INVENTORY_FIELDS = {
  date: { aliases: ["date", "snapshot_date", "as_of"], required: true },
  store: { aliases: ["store_name", "location_name", "Store Name", "store"], required: true },
  sku: { aliases: ["sku"] },
  metal: { aliases: ["metal"] },
  category: { aliases: ["category", "category_code"] },
  units: { aliases: ["quantity", "units", "qty", "stock"], required: true },
} satisfies Record<string, FieldSpec>;

/** GIVA SKU convention: gold SKUs start with GD; the category is the letter code after it. */
export function skuMetal(sku: string): "GOLD" | "SILVER" {
  return sku.toUpperCase().startsWith("GD") ? "GOLD" : "SILVER";
}
export function skuCategory(sku: string): string {
  return sku.toUpperCase().match(/^(?:GD)?([A-Z]+)/)?.[1] ?? "OTHER";
}

export type InventoryRow = { date: string; storeKey: string; metal: "GOLD" | "SILVER"; category: string; units: number };

/** Works for SKU-level rows (date, store, sku, quantity) and pre-summed ones (date, store, metal, category, units). */
export function mapInventory(row: RawRow, c: Record<keyof typeof INVENTORY_FIELDS, string | null>): InventoryRow | null {
  const get = (f: keyof typeof INVENTORY_FIELDS) => (c[f] ? row[c[f]!] : null);
  const date = toIsoDate(get("date"));
  const store = toText(get("store"));
  if (!date || !store) return null;
  const sku = toText(get("sku"));
  const metalText = toText(get("metal"))?.toUpperCase();
  const metal = metalText ? (metalText.startsWith("G") ? "GOLD" : "SILVER") : sku ? skuMetal(sku) : null;
  // Named categories are kept as sent so they line up with sales; raw SKUs fall back to the code.
  const category = toText(get("category")) ?? (sku ? skuCategory(sku) : null);
  if (!metal || !category) return null;
  return { date, storeKey: normName(store), metal, category, units: toNumber(get("units")) };
}

/**
 * Drops snapshot days that cover far fewer stores than the best day: an
 * export that hit a row limit stops part-way through its last day.
 */
export function completeSnapshotDays(storesByDay: Map<string, Set<string>>, threshold = 0.8): Set<string> {
  const most = Math.max(0, ...[...storesByDay.values()].map((s) => s.size));
  return new Set([...storesByDay.entries()].filter(([, s]) => s.size >= most * threshold).map(([d]) => d));
}

/* ---------- Carpet area ---------- */

export const CARPET_FIELDS = {
  store: { aliases: ["Store Name", "store", "location_name", "store_name", "Store"], required: true },
  sqft: {
    aliases: ["Carpet Area", "carpet_area", "Carpet Area (sq ft)", "Carpet Area sqft", "sqft", "sq ft", "area", "carpet"],
    required: true,
  },
} satisfies Record<string, FieldSpec>;

export function mapCarpet(row: RawRow, c: Record<keyof typeof CARPET_FIELDS, string | null>): { storeName: string; sqft: number } | null {
  const storeName = toText(c.store ? row[c.store] : null);
  const sqft = Math.round(toNumber(c.sqft ? row[c.sqft] : null));
  if (!storeName || !(sqft > 0)) return null;
  return { storeName, sqft };
}

/* ---------- Staff register (HR pay register) ---------- */

export const STAFF_FIELDS = {
  employeeNo: { aliases: ["EmployeeNo", "Employee No", "Emp No", "Employee Code", "Emp Code", "employee_id"], required: true },
  name: { aliases: ["Name", "Employee Name", "staff_name"] },
  joinDate: { aliases: ["Join Date", "Joining Date", "Date of Joining", "DOJ", "join_date"], required: true },
  leaveDate: { aliases: ["Leaving Date", "Leave Date", "Date of Leaving", "DOL", "Exit Date", "leaving_date"] },
  department: { aliases: ["Department", "Dept"] },
  designation: { aliases: ["Designation", "Role", "Title"] },
  branch: { aliases: ["Branch", "Store", "Store Name", "Location Name"], required: true },
  city: { aliases: ["Location", "City"] },
} satisfies Record<string, FieldSpec>;

export type StaffRow = {
  employeeNo: string;
  name: string | null;
  designation: string | null;
  branch: string;
  city: string | null;
  joinDate: string;
  leaveDate: string | null;
};

/** Store staff only: other departments on the same register are skipped. */
export function mapStaff(row: RawRow, c: Record<keyof typeof STAFF_FIELDS, string | null>): StaffRow | null {
  const get = (k: keyof typeof STAFF_FIELDS) => toText(c[k] ? row[c[k]!] : null);
  const employeeNo = get("employeeNo");
  const branch = get("branch")?.replace(/\s+/g, " ").trim() ?? null;
  const joinDate = toIsoDate(c.joinDate ? row[c.joinDate] : null);
  const department = get("department");
  if (!employeeNo || !branch || !joinDate) return null;
  if (department && !/ebo|store|retail/i.test(department)) return null;
  return {
    employeeNo,
    name: get("name"),
    designation: get("designation"),
    branch,
    city: get("city"),
    joinDate,
    leaveDate: toIsoDate(c.leaveDate ? row[c.leaveDate] : null),
  };
}

/** "Pay Register For The Month Aug 2026", or a file name like "EBO Store Staff - Aug 2026.xlsx". */
export function registerMonth(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    const m = String(text ?? "").match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*(20\d{2})\b/i);
    if (m) return `${m[2]}-${pad(MONTHS[m[1]!.toLowerCase()]!)}-01`;
  }
  return null;
}

export const STAFF_MAP_FIELDS = {
  branch: { aliases: ["Branch", "HR Branch", "hr_branch"], required: true },
  store: { aliases: ["Store", "Store Name", "store_name", "location_name", "suggested_store"], required: true },
} satisfies Record<string, FieldSpec>;

export function mapStaffLink(row: RawRow, c: Record<keyof typeof STAFF_MAP_FIELDS, string | null>): { branch: string; store: string | null } | null {
  const branch = toText(c.branch ? row[c.branch] : null)?.replace(/\s+/g, " ").trim();
  if (!branch) return null;
  const store = toText(c.store ? row[c.store] : null);
  return { branch, store: store && store !== "-" ? store : null };
}

/* ---------- Matching HR branch names to stores ---------- */

const NCR = new Set(["delhi", "newdelhi", "delhincr", "gurugram", "gurgaon", "noida", "greaternoida", "ghaziabad", "faridabad"]);
const cityKey = (city: string | null | undefined) => {
  const k = normName(city ?? "");
  return NCR.has(k) ? "ncr" : k;
};
const STOP_WORDS = new Set(["hs", "mall", "the", "road", "rd", "store", "giva", "and"]);
const words = (s: string) => s.toLowerCase().replace(/\u00a0/g, " ").match(/[a-z0-9]+/g)?.filter((w) => !STOP_WORDS.has(w)) ?? [];

/** Similarity of two store names, 0-1 (Dice coefficient on letter pairs of the meaningful words). */
export function nameSimilarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = words(s).join(" ");
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const x = pairs(a);
  const y = pairs(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const p of y) counts.set(p, (counts.get(p) ?? 0) + 1);
  let hit = 0;
  for (const p of x) {
    const n = counts.get(p) ?? 0;
    if (n > 0) {
      hit++;
      counts.set(p, n - 1);
    }
  }
  return (2 * hit) / (x.length + y.length);
}

const cityWords = (...cities: (string | null | undefined)[]) => {
  const words = cities.flatMap((c) => (c ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return words.length ? new RegExp(`\\b(${[...new Set(words)].join("|")})[a-z]*\\b`, "gi") : /$^/;
};

/**
 * Best store for an HR branch: the same normalised name, else the most
 * similar name among stores in the same city (Delhi NCR counts as one).
 */
export function matchBranch(
  branch: string,
  city: string | null,
  stores: { key: string; name: string; city: string | null }[],
  minScore = 0.72
): { storeKey: string | null; method: "exact" | "name" | "none"; score: number } {
  const exact = stores.find((s) => s.key === normName(branch));
  if (exact) return { storeKey: exact.key, method: "exact", score: 1 };
  const c = cityKey(city);
  const sameCity = (s: { city: string | null }) => {
    const sc = cityKey(s.city);
    return !c || !sc || sc === c || sc.startsWith(c.slice(0, 4)) || c.startsWith(sc.slice(0, 4));
  };
  // "Jayanagar 2" isn't "Jayanagar 9th Main", and "Sector 14" isn't "Sector 104": numbers must agree
  // (a lone "1" can be left out, as in "Koramangala 1" vs "Koramangala").
  const numbers = (name: string) => [...new Set(name.match(/[0-9]+/g) ?? [])].filter((n) => n !== "1").sort().join(",");
  const want = numbers(branch);
  let best: { key: string; score: number } | null = null;
  for (const s of stores) {
    if (!sameCity(s) || numbers(s.name) !== want) continue;
    // The city adds nothing within a city ("Ring Road, Ahmedabad" vs "CG Road Ahmedabad").
    const dropCity = (name: string) => name.replace(cityWords(city, s.city), " ");
    const score = nameSimilarity(dropCity(branch), dropCity(s.name));
    if (!best || score > best.score) best = { key: s.key, score };
  }
  return best && best.score >= minScore
    ? { storeKey: best.key, method: "name", score: best.score }
    : { storeKey: null, method: "none", score: best?.score ?? 0 };
}

/* ---------- Sales per salesperson ---------- */

export const STAFF_SALES_FIELDS = {
  date: { aliases: ["date", "dates", "day"], required: true },
  store: { aliases: ["location_name", "store", "store_name", "Store Name"], required: true },
  staffId: { aliases: ["staff_id", "Staff ID", "staff code"], required: true },
  staffName: { aliases: ["staff_name", "Staff Name", "name"] },
  sales: { aliases: ["net_sales", "Net_sales_aft_ER_D_P", "sales"], required: true },
  gold: { aliases: ["gold_sales", "G_sales_aft_ER_D_P", "gold"] },
  bills: { aliases: ["bills", "NOB", "nob"], required: true },
  units: { aliases: ["units", "qty", "quantity"] },
} satisfies Record<string, FieldSpec>;

export type StaffSaleRow = {
  date: string;
  storeKey: string;
  staffId: string;
  staffName: string | null;
  sales: number;
  gold: number;
  bills: number;
  units: number;
};

export function mapStaffSale(row: RawRow, c: Record<keyof typeof STAFF_SALES_FIELDS, string | null>): StaffSaleRow | null {
  const date = toIsoDate(c.date ? row[c.date] : null);
  const store = toText(c.store ? row[c.store] : null);
  if (!date || !store) return null;
  return {
    date,
    storeKey: normName(store),
    staffId: toText(c.staffId ? row[c.staffId] : null) ?? "",
    staffName: toText(c.staffName ? row[c.staffName] : null),
    sales: toNumber(c.sales ? row[c.sales] : null),
    gold: toNumber(c.gold ? row[c.gold] : null),
    bills: Math.round(toNumber(c.bills ? row[c.bills] : null)),
    units: toNumber(c.units ? row[c.units] : null),
  };
}
