import { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth";
import { isDevAuthBypass, DEV_USER } from "@/lib/auth/dev-bypass";

// When DEV_AUTH_BYPASS is on, spoof the /api/auth/session endpoint so the
// client-side SessionProvider also sees a valid session (avoids a Keycloak
// redirect loop in the browser while running locally without Keycloak).
function devBypassHandler(req: NextRequest): NextResponse | null {
  if (!isDevAuthBypass) return null;
  const url = new URL(req.url);
  if (url.pathname.endsWith("/session")) {
    return NextResponse.json({
      user: {
        name: `${DEV_USER.firstName} ${DEV_USER.lastName}`,
        email: "dev@local",
        id: DEV_USER.id,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }
  return null;
}

export async function GET(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  return devBypassHandler(req) ?? authHandler(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  return devBypassHandler(req) ?? authHandler(req, ctx);
}
