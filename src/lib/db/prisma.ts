import "server-only";

import { PrismaClient } from "@prisma/client";
import { instrumentObject } from "@foundry/logger";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

  return instrumentObject(client, {
    namePrefix: "prisma",
    captureParameters: { enabled: true, maxDepth: 2 },
    captureResult: false,
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
