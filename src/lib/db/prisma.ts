import "server-only";

import { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@foundry/prisma";

/**
 * App Prisma singleton. Schema and migrations stay app-owned;
 * runtime helpers come from @foundry/prisma.
 */
export const prisma = createPrismaClient(PrismaClient);

export type { PrismaClient };
