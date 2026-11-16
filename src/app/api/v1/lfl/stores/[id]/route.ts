import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getLflService } from "@/modules/lfl/server/container";
import { filtersFrom, guardLfl } from "../../route-helpers";

export const dynamic = "force-dynamic";

/** Everything about one store for the date range; ranks use the filtered stores. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const denied = await guardLfl(request);
    if (denied) return denied;
    return jsonOk(await getLflService().getStoreDetail({ ...filtersFrom(request), storeId: params.id }));
  } catch (error) {
    return jsonError(error);
  }
}
