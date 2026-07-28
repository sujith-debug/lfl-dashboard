import "server-only";

export type AnalyticsQueryRecord = {
  table: string;
  jobId?: string;
  totalRows: number;
  rows: Record<string, unknown>[];
};
