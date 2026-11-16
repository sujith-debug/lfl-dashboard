import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { SyncRequestSchema } from "@/modules/lfl/contracts";
import { getLflSyncService } from "@/modules/lfl/server/container";
import { guardLflAdmin } from "../../route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Sync now" from the admin page; optional { from, to } for a backfill. */
export async function POST(request: NextRequest) {
  try {
    const denied = await guardLflAdmin(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const { from, to } = parseOrThrow(SyncRequestSchema, body);
    return jsonOk(await getLflSyncService().sync({ from, to }));
  } catch (error) {
    return jsonError(error);
  }
}
