import "server-only";

export type AnalyticsDatasetRecord = {
  id: string;
  location?: string;
};

export type AnalyticsPreviewRecord = {
  table: string;
  jobId?: string;
  totalRows: number;
  rows: Record<string, unknown>[];
};
