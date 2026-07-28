import "server-only";

import { createBigQueryAnalyticsRepository } from "./repositories";
import { createAnalyticsService, type AnalyticsService } from "./services";

let analyticsService: AnalyticsService | null = null;

/**
 * Instrumented analytics singletons. Prefer this over importing BigQuery in routes.
 */
export function getAnalyticsService(): AnalyticsService {
  if (!analyticsService) {
    const repository = createBigQueryAnalyticsRepository();
    analyticsService = createAnalyticsService(repository);
  }
  return analyticsService;
}

/** Test helper to inject a fake repository-backed service. */
export function __setAnalyticsServiceForTests(
  service: AnalyticsService | null
): void {
  analyticsService = service;
}
