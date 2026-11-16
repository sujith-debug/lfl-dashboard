import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getLflService } from "@/modules/lfl/server/container";
import { filtersFrom, guardLfl } from "../route-helpers";

export const dynamic = "force-dynamic";

/** LFL dashboard for the given date range and store filters. */
export async function GET(request: NextRequest) {
  try {
    const denied = await guardLfl(request);
    if (denied) return denied;
    return jsonOk(await getLflService().getDashboard(filtersFrom(request)));
  } catch (error) {
    return jsonError(error);
  }
}
