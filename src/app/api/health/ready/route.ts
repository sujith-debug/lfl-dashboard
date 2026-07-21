import { NextResponse } from "next/server";
import { checkDatabaseHealth, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Readiness — app can serve traffic (DB reachable). */
export async function GET() {
  const db = await checkDatabaseHealth(prisma);
  if (!db.ok) {
    return NextResponse.json(
      { status: "not_ready", checks: { database: db } },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ready",
    checks: { database: db },
  });
}
