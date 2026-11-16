/**
 * App-level auth wiring. Swap package versions centrally via foundry-npm;
 * teams only configure env and optional pages here.
 */

import {
  createAuthHandler,
  getUserFromRequest as getUserFromRequestBase,
  getUserFromSession as getUserFromSessionBase,
} from "@foundry/auth-next";
import { DEV_USER, isDevAuthBypass } from "./dev-bypass";

export const { authOptions, authHandler } = createAuthHandler();

export {
  getSession,
  getCurrentUser,
  requireUser,
  unauthorizedResponse,
  forbiddenResponse,
  sessionToKeycloakUser,
} from "@foundry/auth-next";

/** Signed-in user, or the local dev user when DEV_AUTH_BYPASS is on under `next dev`. */
export const getUserFromSession: typeof getUserFromSessionBase = async (options) =>
  isDevAuthBypass ? DEV_USER : getUserFromSessionBase(options);

export const getUserFromRequest: typeof getUserFromRequestBase = async (request, options) =>
  isDevAuthBypass ? DEV_USER : getUserFromRequestBase(request, options);
