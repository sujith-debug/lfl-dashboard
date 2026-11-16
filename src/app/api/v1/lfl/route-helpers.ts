import type { NextRequest } from "next/server";
import { authOptions, getUserFromRequest, unauthorizedResponse } from "@/lib/auth";
import { APP_OPA_ACTIONS, assertOpaAllowed } from "@/lib/authorization";

const FILTER_KEYS = ["from", "to", "region", "subregion", "city", "am", "age", "type", "sqft", "grain", "lflOnly", "concernBasis", "lyFrom", "lyTo", "festival", "excludeClosed"] as const;

/** Sign-in and OPA check shared by the LFL routes; returns a Response to send back when denied. */
export async function guardLfl(
  request: NextRequest,
  action: string = APP_OPA_ACTIONS.LFL_VIEW
): Promise<Response | null> {
  const user = await getUserFromRequest(request, authOptions);
  if (!user) {
    return unauthorizedResponse();
  }
  return assertOpaAllowed(user, action);
}

/** Admin routes: uploads, carpet edits, syncs. */
export const guardLflAdmin = (request: NextRequest) => guardLfl(request, APP_OPA_ACTIONS.LFL_ADMIN);

/** Filter query params as service input; blanks become undefined so defaults apply. */
export function filtersFrom(request: NextRequest, extra: readonly string[] = []): Record<string, string | undefined> {
  const params = request.nextUrl.searchParams;
  const out: Record<string, string | undefined> = {};
  for (const key of [...FILTER_KEYS, ...extra]) {
    out[key] = params.get(key) || undefined;
  }
  return out;
}
