import "server-only";

import type { DataSource } from "../contracts";
import {
  createLflAdminService,
  createLflImportService,
  createLflSyncService,
  syncConfigFromEnv,
  type LflAdminService,
  type LflImportService,
  type LflSyncService,
} from "./ingest";
import {
  createPrismaStoreProfileRepository,
  createSampleLflRepository,
  type LflRepository,
} from "./repositories";
import { createFileStoreProfileRepository } from "./repositories/file-store-profile.repository";
import { createBigQueryLflRepository } from "./repositories/live-lfl.repository";
import { createPostgresLflRepository } from "./repositories/postgres-lfl.repository";
import {
  askConfigFromEnv,
  createLflAskService,
  createLflExportService,
  createLflService,
  type LflAskService,
  type LflExportService,
  type LflService,
} from "./services";

let lflService: LflService | null = null;
let lflExportService: LflExportService | null = null;
let lflImportService: LflImportService | null = null;
let lflSyncService: LflSyncService | null = null;
let lflAdminService: LflAdminService | null = null;
let lflAskService: LflAskService | null = null;

/**
 * LFL_DATA_SOURCE picks where numbers come from:
 * - "bigquery": the feed queries run in BigQuery on a schedule and load into
 *   this app's database, which the dashboard reads
 * - "bigquery-live": the feed queries run in BigQuery on each (cached) load,
 *   with no app database
 * - anything else (default): made-up sample data, so the app runs anywhere
 */
const SOURCES: DataSource[] = ["bigquery", "bigquery-live"];
const dataSource = (): DataSource => SOURCES.find((s) => s === process.env.LFL_DATA_SOURCE) ?? "sample";

function createDataRepository(): LflRepository {
  const source = dataSource();
  if (source === "sample") return createSampleLflRepository();
  if (source === "bigquery-live") return createBigQueryLflRepository();
  return createPostgresLflRepository();
}

export function getLflService(): LflService {
  if (!lflService) {
    const data = createDataRepository();
    // Carpet areas live in the app database; sample stores carry their own, and
    // the live sources read the carpet sheet named in LFL_CARPET_FILE.
    const carpetFile = process.env.LFL_CARPET_FILE?.trim();
    const profiles =
      data.source === "sample"
        ? null
        : data.source === "bigquery-live"
          ? carpetFile
            ? createFileStoreProfileRepository(carpetFile)
            : null
          : createPrismaStoreProfileRepository();
    lflService = createLflService(data, profiles);
  }
  return lflService;
}

export function getLflExportService(): LflExportService {
  if (!lflExportService) {
    lflExportService = createLflExportService(getLflService());
  }
  return lflExportService;
}

export function getLflImportService(): LflImportService {
  if (!lflImportService) {
    lflImportService = createLflImportService();
  }
  return lflImportService;
}

export function getLflSyncService(): LflSyncService {
  if (!lflSyncService) {
    lflSyncService = createLflSyncService(getLflImportService(), syncConfigFromEnv());
  }
  return lflSyncService;
}

export function getLflAdminService(): LflAdminService {
  if (!lflAdminService) {
    lflAdminService = createLflAdminService(dataSource(), syncConfigFromEnv());
  }
  return lflAdminService;
}

/** "Ask the data"; disabled unless LFL_ASK_URL points at an OpenAI-compatible endpoint. */
export function getLflAskService(): LflAskService {
  if (!lflAskService) {
    lflAskService = createLflAskService(getLflService(), askConfigFromEnv());
  }
  return lflAskService;
}

/** Test helper to inject a fake repository-backed service. */
export function __setLflServiceForTests(service: LflService | null): void {
  lflService = service;
}
