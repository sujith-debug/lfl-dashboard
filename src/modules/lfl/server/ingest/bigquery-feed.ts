import "server-only";

import { logger } from "@foundry/logger";
import { bigquery, runQuery } from "@/lib/bigquery";
import type { FeedAccess } from "./feed-sql";
import type { RawRow } from "./table-reader";

/**
 * Runs one feed query in BigQuery with the app's service account
 * (BIGQUERY_SERVICE_ACCOUNT_JSON, BIGQUERY_DEFAULT_PROJECT, BIGQUERY_LOCATION)
 * and returns plain rows for the importer.
 */

const RETRY_DELAYS_MS = [10_000, 45_000];

/** BigQuery hands back DATE / TIMESTAMP as { value } and NUMERIC as Big; the importer wants plain values. */
function plain(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if ("value" in (value as Record<string, unknown>)) return (value as { value: unknown }).value;
  if (typeof (value as { toNumber?: unknown }).toNumber === "function") return (value as { toNumber: () => number }).toNumber();
  return String(value);
}

/** Network blips and BigQuery's rate / backend errors are worth retrying; permissions and bad SQL aren't. */
function isTransient(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  const code = Number(e?.code);
  const message = String(e?.message ?? "");
  return [429, 500, 502, 503, 504].includes(code) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|rateLimitExceeded|backendError/i.test(message);
}

/** A readable reason for the admin page (VPC Service Controls and IAM errors are long). */
export function bigQueryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/VPC Service Controls/i.test(message)) return "BigQuery refused the request: it's outside GIVA's VPC Service Controls perimeter";
  if (/Access Denied|permission/i.test(message)) return `BigQuery access denied: ${message.slice(0, 200)}`;
  return message.slice(0, 300);
}

/** How long a table-access answer is kept, so access granted later is picked up without a restart. */
const ACCESS_TTL_MS = 30 * 60_000;
const access = new Map<string, { at: number; ok: Promise<boolean> }>();

/**
 * Whether the service account can read a table (a free dry run). Only a
 * permission refusal counts as "no"; other failures (network, VPC) throw, so a
 * blip doesn't quietly switch the board to its fallback tables.
 */
export function canRead(table: string): Promise<boolean> {
  const hit = access.get(table);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok;
  const ok = bigquery
    .createQueryJob({ query: `SELECT 1 FROM \`${table}\` LIMIT 1`, dryRun: true, location: process.env.BIGQUERY_LOCATION })
    .then(() => true)
    .catch((error: unknown) => {
      if (/Access Denied|permission/i.test(error instanceof Error ? error.message : String(error))) return false;
      access.delete(table);
      throw new Error(`Checking access to ${table}: ${bigQueryErrorMessage(error)}`);
    });
  access.set(table, { at: Date.now(), ok });
  return ok;
}

const ACCESS_TABLES = [
  "intermediary.ebo_all_data",
  "raw_postgres_giva_db.mto_orders_new",
  "airbyte.shopify_products",
  "airbyte.shopify_product_variants",
  "raw_postgres_giva_db.offline_staff",
  "raw_postgres_giva_db.order_stores",
  "guts.inventory_daily_snapshot",
];

/**
 * The best tables the service account can read for each feed: the exact EBO
 * table when it may, else EBO lines rebuilt from Shopify orders; staff and
 * stock only when their tables are readable. Re-checked every 30 minutes, so
 * granting access switches the feeds over on its own.
 */
export async function bigQueryFeedAccess(): Promise<FeedAccess> {
  const [ebo, mto, products, variants, staff, orderStaff, stock] = await Promise.all(ACCESS_TABLES.map(canRead));
  return {
    sales: ebo ? "ebo" : "shopify",
    mto: mto ? "table" : "tag",
    productTags: Boolean(products && variants),
    staff: Boolean(staff),
    staffSales: Boolean(staff && orderStaff),
    stock: Boolean(stock),
  };
}

export async function fetchFeed(sql: string, label: string): Promise<RawRow[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await runQuery<Record<string, unknown>>(bigquery, sql);
      return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)])));
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransient(error)) {
        throw new Error(`${label}: ${bigQueryErrorMessage(error)}`);
      }
      logger.warn({ label, attempt: attempt + 1, err: bigQueryErrorMessage(error) }, "BigQuery feed query failed; retrying");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
