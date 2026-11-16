import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { BranchLinkUpdateSchema } from "@/modules/lfl/contracts";
import { getLflImportService } from "@/modules/lfl/server/container";
import { guardLflAdmin } from "../../route-helpers";

export const dynamic = "force-dynamic";

/** Link one HR branch to a store (storeKey: null marks it as not a store). */
export async function PUT(request: NextRequest) {
  try {
    const denied = await guardLflAdmin(request);
    if (denied) return denied;
    const { branch, storeKey } = parseOrThrow(BranchLinkUpdateSchema, await request.json());
    await getLflImportService().setBranch(branch, storeKey);
    return jsonOk({ branch, storeKey });
  } catch (error) {
    return jsonError(error);
  }
}
