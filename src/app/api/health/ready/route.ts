import { NextResponse } from "next/server";
import { checkOpaHealth } from "@foundry/opa-client";
import { checkDatabaseHealth, prisma } from "@/lib/db";
import { bigquery, checkBigQueryHealth } from "@/lib/bigquery";

export const dynamic = "force-dynamic";

function isBigQueryConfigured(): boolean {
  return Boolean(
    process.env.BIGQUERY_DEFAULT_PROJECT ||
      process.env.BIGQUERY_PROJECT_ID ||
      process.env.BIGQUERY_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
  );
}

/** Readiness — app can serve traffic (database and OPA bundle reachable). */
export async function GET() {
  const [database, opa] = await Promise.all([
    checkDatabaseHealth(prisma),
    checkOpaHealth(),
  ]);

  const checks: Record<string, unknown> = { database, opa };

  if (isBigQueryConfigured()) {
    checks.bigquery = await checkBigQueryHealth(bigquery);
  }

  const bigqueryOk =
    !("bigquery" in checks) ||
    (checks.bigquery as { ok: boolean }).ok === true;

  if (!database.ok || !opa.ok || !bigqueryOk) {
    return NextResponse.json(
      { status: "not_ready", checks },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ready",
    checks,
  });
}
