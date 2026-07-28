import "server-only";

import { createBigQueryClient } from "@foundry/bigquery";

/**
 * App BigQuery singleton. Project / credentials come from env;
 * query helpers come from @foundry/bigquery.
 */
export const bigquery = createBigQueryClient();

export {
  runQuery,
  queryRows,
  checkBigQueryHealth,
  assertTableAllowed,
  getAllowedDatasetsTables,
  isTableAllowed,
} from "@foundry/bigquery";
export type {
  BigQuery,
  BigQueryClientOptions,
  BigQueryServiceAccountCredentials,
  BigQueryQueryOptions,
  BigQueryQueryResult,
  BigQueryHealthStatus,
  AllowedTablePattern,
} from "@foundry/bigquery";
