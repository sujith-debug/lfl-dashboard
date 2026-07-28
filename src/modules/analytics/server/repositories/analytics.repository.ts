import "server-only";

import type { AnalyticsQueryRecord } from "../models";

export interface AnalyticsRepository {
  queryTable(table: string, limit: number): Promise<AnalyticsQueryRecord>;
}
