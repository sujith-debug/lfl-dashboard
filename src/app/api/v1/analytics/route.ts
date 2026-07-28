import { NextRequest } from "next/server";
import {
  authOptions,
  getUserFromRequest,
  unauthorizedResponse,
} from "@/lib/auth";
import { APP_OPA_ACTIONS, assertOpaAllowed } from "@/lib/authorization";
import { jsonError, jsonOk } from "@/lib/http";
import { getAnalyticsService } from "@/modules/analytics/server/container";

/** Preview rows from a user-provided BigQuery table id. */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(
      user,
      APP_OPA_ACTIONS.ANALYTICS_QUERY
    );
    if (denied) {
      return denied;
    }

    const { searchParams } = request.nextUrl;
    const result = await getAnalyticsService().runQuery({
      table: searchParams.get("table") || undefined,
      limit: searchParams.get("limit") || undefined,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
