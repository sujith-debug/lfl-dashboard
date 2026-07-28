import "server-only";

import { ValidationError, parseOrThrow } from "@foundry/api-core";
import { instrumentObject } from "@foundry/logger";
import { assertTableAllowed, getAllowedDatasetsTables } from "@foundry/bigquery";
import {
  AnalyticsPreviewQuerySchema,
  BigQueryTableIdSchema,
  type AnalyticsOverviewDto,
  type AnalyticsPreviewDto,
} from "../../contracts";
import type { AnalyticsRepository } from "../repositories";

function readSampleTable(): string | null {
  const raw = process.env.BIGQUERY_SAMPLE_TABLE?.trim();
  if (!raw) return null;
  const parsed = BigQueryTableIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function readAllowedTables(): string[] {
  return getAllowedDatasetsTables().map((pattern) =>
    pattern.kind === "exact" ? pattern.value : `${pattern.dataset}.*`
  );
}

export class AnalyticsService {
  constructor(private readonly analytics: AnalyticsRepository) {}

  async getOverview(): Promise<AnalyticsOverviewDto> {
    const projectId = this.analytics.getProjectId() ?? null;
    const configured = Boolean(
      projectId ||
        process.env.BIGQUERY_DEFAULT_PROJECT ||
        process.env.BIGQUERY_PROJECT_ID ||
        process.env.BIGQUERY_SERVICE_ACCOUNT_JSON ||
        process.env.GOOGLE_CLOUD_PROJECT
    );

    if (!configured) {
      return {
        projectId: null,
        configured: false,
        datasets: [],
        sampleTable: readSampleTable(),
        allowedTables: readAllowedTables(),
      };
    }

    const datasets = await this.analytics.listDatasets();
    return {
      projectId,
      configured: true,
      datasets: datasets.map((dataset) => ({
        id: dataset.id,
        ...(dataset.location ? { location: dataset.location } : {}),
      })),
      sampleTable: readSampleTable(),
      allowedTables: readAllowedTables(),
    };
  }

  async previewSample(query: unknown = {}): Promise<AnalyticsPreviewDto> {
    const parsed = parseOrThrow(AnalyticsPreviewQuerySchema, query);
    const rawTable = process.env.BIGQUERY_SAMPLE_TABLE?.trim();
    if (!rawTable) {
      throw new ValidationError(
        "Set BIGQUERY_SAMPLE_TABLE (dataset.table) to enable the sample preview"
      );
    }
    const table = parseOrThrow(BigQueryTableIdSchema, rawTable);
    assertTableAllowed(table);

    const limit = parsed.limit ?? 10;
    const result = await this.analytics.previewTable(table, limit);

    return {
      table: result.table,
      totalRows: result.totalRows,
      rows: result.rows,
      ...(result.jobId ? { jobId: result.jobId } : {}),
    };
  }
}

export function createAnalyticsService(
  repository: AnalyticsRepository
): AnalyticsService {
  return instrumentObject(new AnalyticsService(repository), {
    namePrefix: "analytics.service",
    captureResult: false,
  });
}
