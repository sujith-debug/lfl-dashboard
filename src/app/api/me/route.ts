import { NextRequest } from "next/server";
import {
  getUserFromRequest,
  unauthorizedResponse,
  forbiddenResponse,
} from "@foundry/auth-next";
import { getOpaClient, OPA_ACTIONS } from "@foundry/opa-client";
import { authOptions } from "@/lib/auth";

/**
 * Example protected API: session + OPA gate.
 * Copy this pattern for new routes.
 */
export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request, authOptions);
  if (!user) {
    return unauthorizedResponse();
  }

  const allowed = await getOpaClient().isAllowed(
    user,
    OPA_ACTIONS.ACCESS_PANEL
  );
  if (!allowed) {
    return forbiddenResponse();
  }

  return Response.json({
    id: user.id,
    username: user.username,
    email: user.email,
    groups: user.groups,
  });
}
