import { NextRequest } from "next/server";
import { jsonError } from "@/lib/http";
import { getLflExportService } from "@/modules/lfl/server/container";
import { filtersFrom, guardLfl } from "../route-helpers";

export const dynamic = "force-dynamic";
// exceljs needs Node APIs.
export const runtime = "nodejs";

/**
 * Downloads a report as Excel or CSV.
 * ?report=all|summary|stores|…  &format=xlsx|csv  &metal=all|gold|silver  &store=<id>
 * plus the usual filter params.
 */
export async function GET(request: NextRequest) {
  try {
    const denied = await guardLfl(request);
    if (denied) return denied;
    const file = await getLflExportService().export(filtersFrom(request, ["report", "format", "metal", "store"]));
    const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
    return new Response(body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
