import "server-only";

export type Period = "TY" | "LY";
export type Metal = "GOLD" | "SILVER";

/** This-year range and the same calendar dates one year earlier. */
export type PeriodRanges = {
  from: string;
  to: string;
  lyFrom: string;
  lyTo: string;
};

export type StoreRecord = {
  id: string;
  name: string;
  region: string;
  /** Sub-region (N1, N2, S1, S2, W1, W2, East) when the source has one. */
  subregion?: string | null;
  /** Store master status ("Live", "Closed"), when known. */
  status?: string | null;
  /** Last billed day, when known. */
  lastSaleOn?: string | null;
  city: string;
  am: string;
  /** First billed sale, used for store age and the LFL flag. */
  firstSaleOn: string | null;
  /** Store format, e.g. Mall or HS (high street). */
  type: string | null;
  /** Map position, when the store master has one. */
  lat?: number | null;
  lng?: number | null;
  /** Carpet area when the source has one; the app's store profiles win over it. */
  sqft: number | null;
};

/** One store-day in either period. `date` is the actual calendar date of that period. */
export type StoreDayRecord = {
  storeId: string;
  period: Period;
  date: string;
  sales: number;
  gold: number;
  silver: number;
  bills: number;
  goldBills: number;
  footfall: number;
  silverBills: number;
  goldUnits: number;
  silverUnits: number;
  /** Line sales before E/R and promo: the ASP numerator in #8734. */
  goldLineSales: number;
  silverLineSales: number;
  /** Gold made-to-order: sales (as `gold`), bills, units and line sales. */
  goldMtoSales: number;
  goldMtoBills: number;
  goldMtoUnits: number;
  goldMtoLineSales: number;
};

/** Sales split by metal, segment (karat / classic) and SKU category for the whole range. */
export type SegmentRecord = {
  storeId: string;
  period: Period;
  metal: Metal;
  /** 9KT / 14KT / 18KT for gold, CLASSIC / NON_CLASSIC for silver, UNMAPPED when unknown. */
  segment: string;
  category: string;
  sales: number;
  units: number;
};

/** Units on hand at the end of each period. */
export type InventoryRecord = {
  storeId: string;
  period: Period;
  /** Day the stock was counted, when the source knows it. */
  snapshotDate?: string;
  metal: Metal;
  category: string;
  units: number;
};

export type StaffRecord = {
  staffId: string;
  name: string | null;
  storeId: string;
  startedOn: string;
  active: boolean;
  /** Designation from the HR register, when the source has it. */
  role?: string | null;
  leftOn?: string | null;
};

/** One salesperson's sales in one store over a period (POS staff on each order). */
export type StaffSaleRecord = {
  storeId: string;
  /** POS staff id; "" for orders without a salesperson. */
  staffId: string;
  name: string | null;
  sales: number;
  gold: number;
  bills: number;
  units: number;
  /** Days with at least one sale. */
  days: number;
};

/** Monthly sales per salesperson, for tenure analysis. */
export type StaffSaleMonthRecord = StaffSaleRecord & { month: string };

/** One person on one month's HR register. */
export type StaffRegisterRecord = {
  /** YYYY-MM-01 */
  month: string;
  employeeNo: string;
  name: string | null;
  storeId: string | null;
  role: string | null;
  joinedOn: string;
  leftOn: string | null;
};

/** One store's staff movement in one month (HR registers). */
export type StaffMonthRecord = {
  /** YYYY-MM-01 */
  month: string;
  storeId: string;
  /** Employed on the last day of the month. */
  headcount: number;
  joined: number;
  left: number;
};

export type StoreProfileRecord = {
  storeName: string;
  carpetSqft: number;
};
