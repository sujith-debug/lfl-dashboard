import "server-only";

import { instrumentFunction } from "@foundry/logger";
import { prisma } from "./prisma";

export type DbHealthStatus = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

/**
 * Lightweight readiness probe against PostgreSQL.
 */
export const checkDatabaseHealth = instrumentFunction(
  async function checkDatabaseHealth(): Promise<DbHealthStatus> {
    const startedAt = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown database error",
      };
    }
  },
  {
    name: "db.checkDatabaseHealth",
    captureResult: true,
  }
);
