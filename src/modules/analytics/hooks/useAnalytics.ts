"use client";

import { useCallback, useState } from "react";
import type { AnalyticsQueryResultDto } from "../contracts";

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export function useAnalyticsQuery() {
  const [result, setResult] = useState<AnalyticsQueryResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(async (table: string, limit = 10) => {
    const trimmed = table.trim();
    if (!trimmed) {
      setError("Enter a table id like dataset.table");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        table: trimmed,
        limit: String(limit),
      });
      const response = await fetch(`/api/v1/analytics?${params}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setResult((await response.json()) as AnalyticsQueryResultDto);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to run BigQuery query"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, runQuery };
}
