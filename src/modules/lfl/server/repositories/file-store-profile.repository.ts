import "server-only";

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { instrumentObject, logger } from "@foundry/logger";
import { CARPET_FIELDS, mapCarpet, resolveColumns } from "../ingest/datasets";
import { readTable } from "../ingest/table-reader";
import type { StoreProfileRecord } from "../models";
import type { StoreProfileRepository } from "./lfl.repository";

/**
 * Carpet areas from a sheet on disk (LFL_CARPET_FILE: CSV or XLSX with
 * "Store Name" and "Carpet Area", the same sheet the admin upload takes). For
 * live BigQuery mode, where there's no app database to hold them. Re-read
 * when the file changes.
 */
class FileStoreProfileRepository implements StoreProfileRepository {
  private cached: { mtimeMs: number; rows: StoreProfileRecord[] } | null = null;

  constructor(private readonly path: string) {}

  async list(): Promise<StoreProfileRecord[]> {
    try {
      const { mtimeMs } = await stat(this.path);
      if (this.cached?.mtimeMs === mtimeMs) return this.cached.rows;
      const rows: StoreProfileRecord[] = [];
      let columns: Record<string, string | null> | null = null;
      for await (const raw of readTable(await readFile(this.path), basename(this.path))) {
        columns ??= resolveColumns(Object.keys(raw), CARPET_FIELDS).columns;
        const row = mapCarpet(raw, columns as never);
        if (row) rows.push({ storeName: row.storeName, carpetSqft: row.sqft });
      }
      this.cached = { mtimeMs, rows };
      return rows;
    } catch (error) {
      // A missing or unreadable sheet means no carpet areas, not a broken board.
      logger.warn({ path: basename(this.path), err: error instanceof Error ? error.message : String(error) }, "Carpet area sheet could not be read");
      return [];
    }
  }
}

export function createFileStoreProfileRepository(path: string): StoreProfileRepository {
  return instrumentObject(new FileStoreProfileRepository(path), { namePrefix: "lfl.repository.carpetfile", captureResult: false });
}
