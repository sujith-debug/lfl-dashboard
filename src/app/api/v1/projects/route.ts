import { NextRequest } from "next/server";
import {
  authOptions,
  getUserFromRequest,
  unauthorizedResponse,
} from "@/lib/auth";
import { APP_OPA_ACTIONS, assertOpaAllowed } from "@/lib/authorization";
import { jsonCreated, jsonError, jsonOk } from "@/lib/http";
import { getProjectService } from "@/features/projects/server/container";

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(user, APP_OPA_ACTIONS.PROJECT_LIST);
    if (denied) {
      return denied;
    }

    const { searchParams } = request.nextUrl;
    const result = await getProjectService().list({
      page: searchParams.get("page") || undefined,
      pageSize: searchParams.get("pageSize") || undefined,
      status: searchParams.get("status") || undefined,
      ownerId: searchParams.get("ownerId") || undefined,
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(user, APP_OPA_ACTIONS.PROJECT_CREATE);
    if (denied) {
      return denied;
    }

    const body = await request.json();
    const project = await getProjectService().create(user.id, body);
    return jsonCreated(project);
  } catch (error) {
    return jsonError(error);
  }
}
