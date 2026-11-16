import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getLflAdminService } from "@/modules/lfl/server/container";
import { guardLflAdmin } from "../../route-helpers";

export const dynamic = "force-dynamic";

/** Feed freshness, coverage, recent imports and the carpet sheet (?format=carpet-csv to download it). */
export async function GET(request: NextRequest) {
  try {
    const denied = await guardLflAdmin(request);
    if (denied) return denied;
    if (request.nextUrl.searchParams.get("format") === "branch-csv") {
      return new Response(await getLflAdminService().branchCsv(), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="staff-branch-links.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (request.nextUrl.searchParams.get("format") === "carpet-csv") {
      return new Response(await getLflAdminService().carpetCsv(), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="carpet-areas.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    return jsonOk(await getLflAdminService().status());
  } catch (error) {
    return jsonError(error);
  }
}
