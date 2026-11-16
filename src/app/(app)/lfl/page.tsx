import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOpaClient } from "@foundry/opa-client";
import { logger } from "@foundry/logger";
import { AppError } from "@foundry/api-core";
import { authOptions, getUserFromSession } from "@/lib/auth";
import { APP_OPA_ACTIONS } from "@/lib/authorization";
import { LflFiltersSchema, type LflDashboardDto, type LflFilters } from "@/modules/lfl/contracts";
import { LflDashboard } from "@/modules/lfl/components/dashboard/LflDashboard";
import { isTabKey } from "@/modules/lfl/components/tabs";
import { defaultFilters, latestCompleteDay } from "@/modules/lfl/components/ranges";
import { getLflService } from "@/modules/lfl/server/container";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store LFL Board · GIVA" };

type SearchParams = Record<string, string | string[] | undefined>;

function initialFilters(searchParams: SearchParams, today: string): LflFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const defaults = defaultFilters(today);
  const parsed = LflFiltersSchema.safeParse({
    from: pick("from") ?? defaults.from,
    to: pick("to") ?? defaults.to,
    region: pick("region"),
    subregion: pick("subregion"),
    city: pick("city"),
    am: pick("am"),
    age: pick("age"),
    type: pick("type"),
    sqft: pick("sqft"),
    grain: pick("grain"),
    lflOnly: pick("lflOnly"),
    concernBasis: pick("concernBasis"),
    lyFrom: pick("lyFrom"),
    lyTo: pick("lyTo"),
    festival: pick("festival"),
    excludeClosed: pick("excludeClosed"),
  });
  return parsed.success ? parsed.data : defaults;
}

/**
 * Server Component: checks the session and OPA, then renders the first view
 * straight from the service (no HTTP hop). Filter changes go through
 * /api/v1/lfl/dashboard from the client.
 */
export default async function LflPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getUserFromSession(authOptions);
  if (!user) {
    redirect("/auth/signin?callbackUrl=/lfl");
  }
  const allowed = await getOpaClient().isAllowed(user, APP_OPA_ACTIONS.LFL_VIEW);
  if (!allowed) {
    redirect("/auth/error?error=AccessDenied");
  }

  const today = latestCompleteDay();
  const filters = initialFilters(searchParams, today);
  let data: LflDashboardDto | null = null;
  let error: string | null = null;
  try {
    data = await getLflService().getDashboard(filters);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "LFL dashboard failed to load");
    error = err instanceof AppError ? err.message : "Couldn't load the dashboard. Try again in a minute.";
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
  return (
    <LflDashboard
      userName={name}
      today={today}
      initialFilters={filters}
      initialData={data}
      initialError={error}
      initialTab={isTabKey(searchParams.tab) ? searchParams.tab : undefined}
      initialStore={typeof searchParams.store === "string" && searchParams.store.length <= 64 ? searchParams.store : undefined}
    />
  );
}
