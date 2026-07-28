import "server-only";

import type {
  AnalyticsDatasetRecord,
  AnalyticsPreviewRecord,
} from "../models";

export interface AnalyticsRepository {
  getProjectId(): string | undefined;
  listDatasets(maxResults?: number): Promise<AnalyticsDatasetRecord[]>;
  previewTable(
    table: string,
    limit: number
  ): Promise<AnalyticsPreviewRecord>;
}
