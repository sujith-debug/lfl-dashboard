/**
 * Next.js loads this file before application code. Keeping SDK registration
 * here allows HTTP, fetch, database, and supported library instrumentation to
 * patch modules before they are imported.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTracing } = await import("@foundry/logger/tracing");
    registerTracing({
      serviceName: process.env.OTEL_SERVICE_NAME || "foundry-app",
    });

    // Optional in-process schedule for the BigQuery pull. With several app
    // instances only one runs at a time (the sync skips if another is running);
    // an external scheduler calling POST /api/v1/lfl/sync works too.
    const minutes = Number(process.env.LFL_SYNC_INTERVAL_MINUTES);
    if (minutes >= 15 && process.env.LFL_DATA_SOURCE === "bigquery") {
      const { logger } = await import("@foundry/logger");
      const RETRY_MS = 15 * 60_000;
      let running = false;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const run = async () => {
        // Timers that fire together (e.g. after the machine wakes) share one run.
        if (running) return;
        running = true;
        if (retry) clearTimeout(retry);
        retry = null;
        try {
          const { getLflSyncService } = await import("@/modules/lfl/server/container");
          const report = await getLflSyncService().sync();
          const failed = report.results.filter((r) => !r.ok);
          logger.info({ report }, "Scheduled LFL sync finished");
          // Don't wait a full interval to recover from a failed pull.
          if (failed.length) retry = setTimeout(run, RETRY_MS);
        } catch (error) {
          logger.error({ err: error instanceof Error ? error.message : String(error) }, "Scheduled LFL sync failed");
          retry = setTimeout(run, RETRY_MS);
        } finally {
          running = false;
        }
      };
      setTimeout(run, 60_000);
      setInterval(run, minutes * 60_000);
      logger.info({ minutes }, "LFL sync scheduled");
    }

    // Live BigQuery mode: keep the default view and every quick range loaded,
    // so picking one doesn't wait. Runs one view at a time with its queries
    // behind viewers' ones; finished windows stay cached for a day, so most
    // rounds hit the cache. Each query is billed, so festivals load on demand.
    if (process.env.LFL_DATA_SOURCE === "bigquery-live") {
      const { logger } = await import("@foundry/logger");
      let warming = false;
      const warm = async () => {
        if (warming) return;
        warming = true;
        const started = Date.now();
        try {
          const { getLflService } = await import("@/modules/lfl/server/container");
          const { inBackground } = await import("@/modules/lfl/server/repositories/live-lfl.repository");
          const { defaultFilters, latestCompleteDay, quickRange, QUICK_RANGES } = await import("@/modules/lfl/components/ranges");
          const today = latestCompleteDay();
          const base = defaultFilters(today);
          const views = [
            base,
            ...QUICK_RANGES.map((q) => ({ ...base, ...quickRange(q.key, today) })),
          ];
          for (const view of views) {
            await inBackground(() => getLflService().getDashboard(view)).catch((error: unknown) =>
              logger.warn({ view: view.festival ?? `${view.from}..${view.to}`, err: error instanceof Error ? error.message : String(error) }, "LFL live warm-up view failed")
            );
          }
          logger.info({ views: views.length, ms: Date.now() - started }, "LFL live warm-up done");
        } finally {
          warming = false;
        }
      };
      setTimeout(() => void warm(), 5_000);
      setInterval(() => void warm(), 10 * 60_000);
    }
  }
}
