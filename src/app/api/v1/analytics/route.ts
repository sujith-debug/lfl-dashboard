import { NextRequest } from "next/server";
import {
  authOptions,
  getUserFromRequest,
  unauthorizedResponse,
} from "@/lib/auth";
import { APP_OPA_ACTIONS, assertOpaAllowed } from "@/lib/authorization";
import { jsonError, jsonOk } from "@/lib/http";
import { getAnalyticsService } from "@/modules/analytics/server/container";

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(
      user,
      APP_OPA_ACTIONS.ANALYTICS_READ
    );
    if (denied) {
      return denied;
    }

    const overview = await getAnalyticsService().getOverview();
    return jsonOk(overview);
  } catch (error) {
    return jsonError(error);
  }
}
