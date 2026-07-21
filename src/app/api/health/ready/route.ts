import { NextResponse } from "next/server";
import { checkOpaHealth } from "@foundry/opa-client";
import { checkDatabaseHealth, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Readiness — app can serve traffic (database and OPA bundle reachable). */
export async function GET() {
  const [database, opa] = await Promise.all([
    checkDatabaseHealth(prisma),
    checkOpaHealth(),
  ]);

  if (!database.ok || !opa.ok) {
    return NextResponse.json(
      { status: "not_ready", checks: { database, opa } },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ready",
    checks: { database, opa },
  });
}
