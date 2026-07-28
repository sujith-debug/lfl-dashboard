import "server-only";

import { instrumentObject } from "@foundry/logger";
import { bigquery, runQuery } from "@/lib/bigquery";
import type { AnalyticsQueryRecord } from "../models";
import type { AnalyticsRepository } from "./analytics.repository";

class BigQueryAnalyticsRepository implements AnalyticsRepository {
  async queryTable(
    table: string,
    limit: number
  ): Promise<AnalyticsQueryRecord> {
    // Table id is validated upstream; BigQuery does not accept table names as params.
    const { rows, totalRows, jobId } = await runQuery<Record<string, unknown>>(
      bigquery,
      `SELECT * FROM \`${table}\` LIMIT @limit`,
      {
        params: { limit },
        types: { limit: "INT64" },
      }
    );

    return {
      table,
      totalRows,
      rows,
      ...(jobId ? { jobId } : {}),
    };
  }
}

export function createBigQueryAnalyticsRepository(): AnalyticsRepository {
  return instrumentObject(new BigQueryAnalyticsRepository(), {
    namePrefix: "analytics.repository",
    captureResult: false,
  });
}
