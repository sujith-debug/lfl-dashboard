"use client";

import { useAnalytics } from "@/modules/analytics/hooks/useAnalytics";

/**
 * Client island: reads BigQuery via /api/v1/analytics.
 * Demonstrates @foundry/bigquery wiring in a feature module.
 */
export function AnalyticsPanel() {
  const {
    overview,
    preview,
    loading,
    previewLoading,
    error,
    refresh,
    loadPreview,
  } = useAnalytics();

  return (
    <section className="mt-8 rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">BigQuery analytics</h2>
          <p className="mt-1 text-sm text-slate-500">
            Reference module using <code className="text-slate-700">@foundry/bigquery</code>{" "}
            — list datasets and preview a configured sample table.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="animate-pulse text-sm text-slate-500">
          Loading BigQuery overview…
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && overview && !overview.configured ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          BigQuery is not configured. Set{" "}
          <code>BIGQUERY_DEFAULT_PROJECT</code> and{" "}
          <code>BIGQUERY_SERVICE_ACCOUNT_JSON</code> (or ADC /{" "}
          <code>GOOGLE_APPLICATION_CREDENTIALS</code>) to list datasets.
        </p>
      ) : null}

      {!loading && overview?.configured ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-slate-700">Project</h3>
            <p className="mt-1 font-mono text-sm text-slate-900">
              {overview.projectId ?? "(ADC default)"}
            </p>

            <h3 className="mt-4 text-sm font-medium text-slate-700">
              Allowlist
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {overview.allowedTables.length === 0 ? (
                <>
                  Unrestricted (set <code>BQ_ALLOWED_DATASETS_TABLES</code> to
                  limit queries).
                </>
              ) : (
                <span className="font-mono text-slate-800">
                  {overview.allowedTables.join(", ")}
                </span>
              )}
            </p>

            <h3 className="mt-4 text-sm font-medium text-slate-700">
              Datasets
            </h3>
            {overview.datasets.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No datasets found.</p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border">
                {overview.datasets.map((dataset) => (
                  <li
                    key={dataset.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-slate-800">{dataset.id}</span>
                    {dataset.location ? (
                      <span className="text-slate-500">{dataset.location}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Sample table preview
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {overview.sampleTable ? (
                <>
                  Configured table:{" "}
                  <code className="text-slate-700">{overview.sampleTable}</code>
                </>
              ) : (
                <>
                  Set <code>BIGQUERY_SAMPLE_TABLE</code> (e.g.{" "}
                  <code>analytics.events</code>) to enable a parameterized{" "}
                  <code>SELECT *</code> preview.
                </>
              )}
            </p>

            {overview.sampleTable ? (
              <button
                type="button"
                disabled={previewLoading}
                onClick={() => void loadPreview()}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {previewLoading ? "Querying…" : "Run preview query"}
              </button>
            ) : null}

            {preview ? (
              <div className="mt-4 overflow-x-auto rounded-lg border">
                <p className="border-b bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {preview.totalRows} row(s)
                  {preview.jobId ? ` · job ${preview.jobId}` : ""}
                </p>
                <pre className="max-h-64 overflow-auto p-3 text-xs text-slate-800">
                  {JSON.stringify(preview.rows, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
