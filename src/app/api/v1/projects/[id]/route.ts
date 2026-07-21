import { NextRequest } from "next/server";
import {
  authOptions,
  getUserFromRequest,
  unauthorizedResponse,
} from "@/lib/auth";
import { APP_OPA_ACTIONS, assertOpaAllowed } from "@/lib/authorization";
import { jsonError, jsonOk } from "@/lib/http";
import { parseOrThrow } from "@foundry/api-core";
import { ArchiveProjectInputSchema } from "@/modules/projects/contracts";
import { getProjectService } from "@/modules/projects/server/container";

type RouteContext = { params: { id: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(user, APP_OPA_ACTIONS.PROJECT_READ);
    if (denied) {
      return denied;
    }

    const project = await getProjectService().getById(context.params.id);
    return jsonOk(project);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(user, APP_OPA_ACTIONS.PROJECT_UPDATE);
    if (denied) {
      return denied;
    }

    const body = await request.json();
    const project = await getProjectService().update(context.params.id, body);
    return jsonOk(project);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(request, authOptions);
    if (!user) {
      return unauthorizedResponse();
    }

    const denied = await assertOpaAllowed(
      user,
      APP_OPA_ACTIONS.PROJECT_ARCHIVE
    );
    if (denied) {
      return denied;
    }

    const body = await request.json().catch(() => ({}));
    const { version } = parseOrThrow(ArchiveProjectInputSchema, body);
    const project = await getProjectService().archive(
      context.params.id,
      version
    );
    return jsonOk(project);
  } catch (error) {
    return jsonError(error);
  }
}
