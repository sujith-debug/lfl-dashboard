import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { logger } from "@foundry/logger";
import { OPA_ACTIONS } from "@foundry/opa-client/types";
import { isAllowedWithFetch } from "@foundry/opa-client/edge";

const OPA_ACCOUNT =
  process.env.OPA_ACCOUNT || process.env.KEYCLOAK_CLIENT_ID || "app";

async function checkOpaAccess(token: {
  id?: string;
  username?: string;
  groups?: string[];
  resource_access?: Record<string, { roles: string[] }>;
  realm_access?: { roles: string[] };
} | null): Promise<boolean> {
  if (!token) {
    return false;
  }

  const user = {
    id: token.id || "",
    username: token.username || "",
    groups: token.groups || [],
    resource_access: token.resource_access || {},
    realm_access: token.realm_access || { roles: [] },
  };

  return isAllowedWithFetch(user, OPA_ACTIONS.ACCESS_PANEL, {
    account: OPA_ACCOUNT,
  });
}

export default withAuth(
  async function middleware(req) {
    const token = req.nextauth.token;
    const hasAccess = await checkOpaAccess(token);

    if (!hasAccess) {
      logger.warn(
        {
          userId: token?.id,
          username: token?.username,
        },
        "Access denied: OPA policy check failed"
      );
      return NextResponse.redirect(
        new URL("/auth/error?error=AccessDenied", req.url)
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/panel/:path*", "/api/me", "/api/v1/:path*"],
};
