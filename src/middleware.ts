import { getToken } from "next-auth/jwt";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent } from "next/server";
import { isDevAuthBypass } from "@/lib/auth/dev-bypass";
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

const authMiddleware = withAuth(
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
    pages: {
      signIn: "/auth/signin",
    },
  }
);

/** Same envelope as @foundry/http-next's jsonError. */
const apiError = (status: 401 | 403, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * API calls are refused with JSON, never redirected: a fetch would follow a
 * redirect to the sign-in page and get 200 HTML instead of an error.
 */
async function apiMiddleware(req: NextRequestWithAuth): Promise<NextResponse> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return apiError(401, "UNAUTHORIZED", "Sign in to continue.");
  }
  if (!(await checkOpaAccess(token as Parameters<typeof checkOpaAccess>[0]))) {
    logger.warn({ userId: token.id, username: token.username }, "Access denied: OPA policy check failed (API)");
    return apiError(403, "FORBIDDEN", "You don't have access to this app.");
  }
  return NextResponse.next();
}

export default function middleware(req: NextRequestWithAuth, event: NextFetchEvent) {
  // Local `next dev` only: pages and APIs supply the dev user themselves.
  if (isDevAuthBypass) {
    return NextResponse.next();
  }
  // Scheduler trigger: authenticated by its own bearer token in the route.
  if (req.nextUrl.pathname === "/api/v1/lfl/sync" && req.method === "POST") {
    return NextResponse.next();
  }
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return apiMiddleware(req);
  }
  return authMiddleware(req, event);
}

export const config = {
  matcher: ["/lfl/:path*", "/panel/:path*", "/api/me", "/api/v1/:path*"],
};
