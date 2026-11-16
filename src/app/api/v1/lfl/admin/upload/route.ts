import { NextRequest } from "next/server";
import { ValidationError } from "@foundry/api-core";
import { jsonError, jsonOk } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { UploadDatasetSchema } from "@/modules/lfl/contracts";
import { getLflImportService } from "@/modules/lfl/server/container";
import { guardLflAdmin } from "../../route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Big exports (the SKU file) take a while to read.
export const maxDuration = 300;

const MAX_BYTES = 60 * 1024 * 1024;

/** Upload a CSV / XLSX for one feed: multipart fields `dataset` and `file`. */
export async function POST(request: NextRequest) {
  try {
    const denied = await guardLflAdmin(request);
    if (denied) return denied;
    const form = await request.formData();
    const dataset = parseOrThrow(UploadDatasetSchema, form.get("dataset"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError("Choose a CSV or Excel file to upload");
    }
    if (file.size > MAX_BYTES) {
      throw new ValidationError("That file is over 60 MB. Send totals per store and category instead of raw SKUs.");
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      throw new ValidationError("Use a .csv or .xlsx file");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return jsonOk(await getLflImportService().importFile(dataset, buffer, file.name, "upload"));
  } catch (error) {
    return jsonError(error);
  }
}
