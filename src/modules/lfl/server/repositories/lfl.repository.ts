import "server-only";

import type { DataSource } from "../../contracts";
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
  StoreProfileRecord,
  StoreRecord,
} from "../models";

export interface LflRepository {
  readonly source: DataSource;
  listStores(): Promise<StoreRecord[]>;
  storeDays(ranges: PeriodRanges): Promise<StoreDayRecord[]>;
  /** Null when the source has no karat / classic / category split. */
  segments(ranges: PeriodRanges): Promise<SegmentRecord[] | null>;
  /** Null when no inventory source is connected. */
  inventory(asOf: { ty: string; ly: string }): Promise<InventoryRecord[] | null>;
  /** Null when no staff source is connected. */
  staff(asOf: string): Promise<StaffRecord[] | null>;
  /** Monthly headcount, joiners and leavers per store; sources without history leave it out. */
  staffHistory?(): Promise<StaffMonthRecord[] | null>;
  /** Sales per salesperson per store over the range (this year only). */
  staffSales?(range: { from: string; to: string }): Promise<StaffSaleRecord[] | null>;
  /** Monthly sales per salesperson and every HR register, for the tenure vs sales view. */
  staffPerformance?(): Promise<{ sales: StaffSaleMonthRecord[]; registers: StaffRegisterRecord[] } | null>;
}

/** App-owned store attributes (carpet area) kept in PostgreSQL. */
export interface StoreProfileRepository {
  list(): Promise<StoreProfileRecord[]>;
}
