import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import type { AskStatusDto } from "@/modules/lfl/contracts";
import { getLflAskService } from "@/modules/lfl/server/container";
import { filtersFrom, guardLfl } from "../route-helpers";

export const dynamic = "force-dynamic";

/** Whether "Ask the data" is configured, so the UI can hide the button. */
export async function GET(request: NextRequest) {
  try {
    const denied = await guardLfl(request);
    if (denied) return denied;
    return jsonOk<AskStatusDto>({ enabled: getLflAskService().enabled });
  } catch (error) {
    return jsonError(error);
  }
}

/** Answer a question about the view described by the filter query params. */
export async function POST(request: NextRequest) {
  try {
    const denied = await guardLfl(request);
    if (denied) return denied;
    return jsonOk(await getLflAskService().ask(filtersFrom(request), await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
