"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LflDashboardDto, LflFilters, StoreDetailDto } from "../contracts";

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export function toSearchParams(filters: LflFilters): URLSearchParams {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, grain: filters.grain });
  for (const key of ["region", "subregion", "city", "am", "age", "type", "sqft"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (!filters.lflOnly) params.set("lflOnly", "false");
  if (filters.excludeClosed) params.set("excludeClosed", "true");
  if (filters.concernBasis !== "ytd") params.set("concernBasis", filters.concernBasis);
  if (filters.lyFrom && filters.lyTo) {
    params.set("lyFrom", filters.lyFrom);
    params.set("lyTo", filters.lyTo);
  }
  if (filters.festival) params.set("festival", filters.festival);
  return params;
}

/** Link to a download; the browser sends the session cookie, so auth still applies. */
export function exportHref(
  filters: LflFilters,
  options: { report: string; format: "xlsx" | "csv"; metal?: string; store?: string }
): string {
  const params = toSearchParams(filters);
  params.set("report", options.report);
  params.set("format", options.format);
  if (options.metal && options.metal !== "all") params.set("metal", options.metal);
  if (options.store) params.set("store", options.store);
  return `/api/v1/lfl/export?${params}`;
}

function signInAgain() {
  window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** Fetches JSON from an LFL endpoint; a newer request cancels the older one. */
function useLflFetch<T>(initial: T | null, initialError: string | null = null) {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const load = useCallback(async (url: string) => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      const response = await fetch(url, { signal: controller.signal });
      // An expired session gets 401 JSON from the middleware; a redirect or HTML means the same.
      const isJson = response.headers.get("content-type")?.includes("application/json");
      if (response.status === 401 || response.redirected || (response.ok && !isJson)) {
        signInAgain();
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setData((await response.json()) as T);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Couldn't load the data");
    } finally {
      if (inflight.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  const reset = useCallback(() => {
    inflight.current?.abort();
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, error, loading, load, reset };
}

export function useLflDashboard(initial: LflDashboardDto | null, initialError: string | null) {
  const { load, ...rest } = useLflFetch<LflDashboardDto>(initial, initialError);
  const loadFor = useCallback(
    (filters: LflFilters) => load(`/api/v1/lfl/dashboard?${toSearchParams(filters)}`),
    [load]
  );
  return { ...rest, load: loadFor };
}

export function useStoreDetail() {
  const { load, ...rest } = useLflFetch<StoreDetailDto>(null);
  const loadFor = useCallback(
    (storeId: string, filters: LflFilters) =>
      load(`/api/v1/lfl/stores/${encodeURIComponent(storeId)}?${toSearchParams(filters)}`),
    [load]
  );
  return { ...rest, load: loadFor };
}
