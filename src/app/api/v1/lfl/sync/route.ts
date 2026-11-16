import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getLflSyncService } from "@/modules/lfl/server/container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function tokenMatches(header: string | null): boolean {
  const expected = process.env.LFL_SYNC_TOKEN;
  if (!expected || expected.length < 24 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Machine trigger for schedulers (e.g. EventBridge every 6 hours):
 *   POST /api/v1/lfl/sync   Authorization: Bearer $LFL_SYNC_TOKEN
 * Off unless LFL_SYNC_TOKEN (24+ characters) is set. Middleware lets this
 * one path through without a user session; the token is the auth.
 */
export async function POST(request: NextRequest) {
  try {
    if (!tokenMatches(request.headers.get("authorization"))) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Bad or missing sync token" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return jsonOk(await getLflSyncService().sync());
  } catch (error) {
    return jsonError(error);
  }
}
