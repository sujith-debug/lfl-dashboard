import "server-only";

import { parseOrThrow } from "@foundry/api-core";
import { instrumentObject } from "@foundry/logger";
import { assertTableAllowed } from "@foundry/bigquery";
import {
  AnalyticsQueryInputSchema,
  type AnalyticsQueryResultDto,
} from "../../contracts";
import type { AnalyticsRepository } from "../repositories";

export class AnalyticsService {
  constructor(private readonly analytics: AnalyticsRepository) {}

  async runQuery(input: unknown): Promise<AnalyticsQueryResultDto> {
    const parsed = parseOrThrow(AnalyticsQueryInputSchema, input);
    assertTableAllowed(parsed.table);

    const limit = parsed.limit ?? 10;
    const result = await this.analytics.queryTable(parsed.table, limit);

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
