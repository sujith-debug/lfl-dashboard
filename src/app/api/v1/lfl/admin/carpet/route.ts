import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { CarpetUpdateSchema } from "@/modules/lfl/contracts";
import { getLflImportService } from "@/modules/lfl/server/container";
import { guardLflAdmin } from "../../route-helpers";

export const dynamic = "force-dynamic";

/** Set (or clear, with sqft: null) one store's carpet area. */
export async function PUT(request: NextRequest) {
  try {
    const denied = await guardLflAdmin(request);
    if (denied) return denied;
    const { storeName, sqft } = parseOrThrow(CarpetUpdateSchema, await request.json());
    await getLflImportService().setCarpet(storeName, sqft);
    return jsonOk({ storeName, sqft });
  } catch (error) {
    return jsonError(error);
  }
}
