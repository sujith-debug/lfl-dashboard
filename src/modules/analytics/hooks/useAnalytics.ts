"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AnalyticsOverviewDto,
  AnalyticsPreviewDto,
} from "../contracts";

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export function useAnalytics() {
  const [overview, setOverview] = useState<AnalyticsOverviewDto | null>(null);
  const [preview, setPreview] = useState<AnalyticsPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/analytics");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setOverview((await response.json()) as AnalyticsOverviewDto);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load analytics"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/analytics/preview?limit=5");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setPreview((await response.json()) as AnalyticsPreviewDto);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to preview BigQuery table"
      );
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    overview,
    preview,
    loading,
    previewLoading,
    error,
    refresh,
    loadPreview,
  };
}
