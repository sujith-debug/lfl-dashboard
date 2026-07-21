import "server-only";

import type { KeycloakUserInfo } from "@foundry/auth-next";
import { getOpaClient } from "@foundry/opa-client";
import { forbiddenResponse } from "@/lib/auth";

export async function assertOpaAllowed(
  user: KeycloakUserInfo,
  action: string
): Promise<Response | null> {
  const allowed = await getOpaClient().isAllowed(user, action);
  if (!allowed) {
    return forbiddenResponse();
  }
  return null;
}

export { APP_OPA_ACTIONS } from "./actions";
export type { AppOpaAction } from "./actions";
