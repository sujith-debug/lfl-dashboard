import type { KeycloakUserInfo } from "@foundry/auth-next";

/**
 * Local-only sign-in bypass for running without Keycloak. On only under
 * `next dev` with DEV_AUTH_BYPASS=true; production builds inline
 * NODE_ENV=production, so this is always false there. OPA still decides access.
 */
export const isDevAuthBypass =
  process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "true";

export const DEV_USER: KeycloakUserInfo = {
  id: "dev-user",
  username: "dev",
  firstName: "Local",
  lastName: "Developer",
  groups: [],
  resource_access: {},
  realm_access: { roles: [] },
};
