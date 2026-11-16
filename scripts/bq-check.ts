/**
 * Checks the BigQuery service account in .env can reach each table the LFL
 * feeds read. Dry runs only: nothing is scanned or billed.
 *   npm run bq:check
 */
import { createBigQueryClient } from "@foundry/bigquery";

const TABLES = [
  "intermediary.ebo_all_data",
  "givametabse.orders",
  "raw_postgres_giva_db.offline_stores",
  "givametabse.tangoeye_data",
  "airbyte.shopify_products",
  "airbyte.shopify_product_variants",
  "guts.inventory_daily_snapshot",
  "raw_postgres_giva_db.order_stores",
  "raw_postgres_giva_db.offline_staff",
  "raw_postgres_giva_db.mto_orders_new",
];

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("VPC Service Controls")) return "blocked by VPC Service Controls (request is from outside GIVA's allowed network)";
  if (/Access Denied|permission/i.test(message)) return "no permission for this table (needs BigQuery Data Viewer on the dataset)";
  if (/Not found/i.test(message)) return "table not found";
  return message.slice(0, 160);
}

async function main() {
  const email = (() => {
    try {
      return JSON.parse(process.env.BIGQUERY_SERVICE_ACCOUNT_JSON ?? "{}").client_email ?? "(none)";
    } catch {
      return "(BIGQUERY_SERVICE_ACCOUNT_JSON is not valid JSON)";
    }
  })();
  console.log(`Service account: ${email}`);
  console.log(`Project: ${process.env.BIGQUERY_DEFAULT_PROJECT ?? "(unset)"}  Location: ${process.env.BIGQUERY_LOCATION ?? "(unset)"}\n`);

  const bq = createBigQueryClient();
  let ok = 0;
  for (const table of TABLES) {
    try {
      await bq.createQueryJob({ query: `SELECT 1 FROM \`${table}\` LIMIT 1`, dryRun: true, location: process.env.BIGQUERY_LOCATION });
      console.log(`  OK      ${table}`);
      ok++;
    } catch (error) {
      console.log(`  FAILED  ${table}: ${reason(error)}`);
    }
  }
  console.log(`\n${ok} of ${TABLES.length} tables reachable.`);
  process.exitCode = ok === TABLES.length ? 0 : 1;
}

main().catch((error) => {
  console.error(reason(error));
  process.exitCode = 1;
});
