"use client";

import { FormEvent, useState } from "react";
import { useAnalyticsQuery } from "@/modules/analytics/hooks/useAnalytics";

/**
 * Client island: accepts a table id, runs a parameterized BigQuery preview
 * via /api/v1/analytics, and renders the returned rows.
 */
export function AnalyticsPanel() {
  const { result, loading, error, runQuery } = useAnalyticsQuery();
  const [table, setTable] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery(table, 10);
  }

  return (
    <section className="mt-8 rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">BigQuery query</h2>
        <p className="mt-1 text-sm text-slate-500">
          Preview any table with{" "}
          <code className="text-slate-700">SELECT * … LIMIT @limit</code> via{" "}
          <code className="text-slate-700">@foundry/bigquery</code>. Use{" "}
          <code className="text-slate-700">dataset.table</code> or{" "}
          <code className="text-slate-700">project.dataset.table</code>.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">Table</span>
          <input
            type="text"
            value={table}
            onChange={(event) => setTable(event.target.value)}
            placeholder="analytics.events"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !table.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? "Querying…" : "Run query"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <p className="border-b bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <code className="text-slate-700">{result.table}</code>
            {" · "}
            {result.totalRows} row(s)
            {result.jobId ? ` · job ${result.jobId}` : ""}
          </p>
          <pre className="max-h-80 overflow-auto p-3 text-xs text-slate-800">
            {JSON.stringify(result.rows, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
