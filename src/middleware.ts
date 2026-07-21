import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { logger } from "@foundry/logger";
import { OPA_ACTIONS } from "@foundry/opa-client/types";
import {
  buildOpaInput,
  buildOpaSubject,
} from "@foundry/opa-client/helpers";

const OPA_ACCOUNT =
  process.env.OPA_ACCOUNT || process.env.KEYCLOAK_CLIENT_ID || "app";
const OPA_URL =
  process.env.OPA_URL ||
  "http://localhost:8181/v1/data/permission/app/allow";

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

  const input = buildOpaInput(
    buildOpaSubject(user),
    OPA_ACTIONS.ACCESS_PANEL,
    OPA_ACCOUNT
  );

  try {
    const response = await fetch(OPA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      logger.error("OPA policy request failed", { status: response.status });
      return false;
    }

    const data = await response.json();
    return data?.result === true;
  } catch (error) {
    logger.error("Failed to check OPA policy", { error, userId: token.id });
    return false;
  }
}

export default withAuth(
  async function middleware(req) {
    const token = req.nextauth.token;
    const hasAccess = await checkOpaAccess(token);

    if (!hasAccess) {
      logger.warn("Access denied: OPA policy check failed", {
        userId: token?.id,
        username: token?.username,
      });
      return NextResponse.redirect(new URL("/auth/error?error=AccessDenied", req.url));
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
