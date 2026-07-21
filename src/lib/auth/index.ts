/**
 * App-level auth wiring. Swap package versions centrally via foundry-npm;
 * teams only configure env and optional pages here.
 */

import { createAuthHandler } from "@foundry/auth-next";

export const { authOptions, authHandler } = createAuthHandler();

export {
  getSession,
  getUserFromSession,
  getCurrentUser,
  requireUser,
  getUserFromRequest,
  unauthorizedResponse,
  forbiddenResponse,
  sessionToKeycloakUser,
} from "@foundry/auth-next";
