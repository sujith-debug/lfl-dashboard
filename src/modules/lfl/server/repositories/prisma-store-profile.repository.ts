import "server-only";

import { instrumentObject } from "@foundry/logger";
import { mapPrismaError } from "@foundry/prisma";
import { prisma } from "@/lib/db/prisma";
import type { StoreProfileRecord } from "../models";
import type { StoreProfileRepository } from "./lfl.repository";

class PrismaStoreProfileRepository implements StoreProfileRepository {
  async list(): Promise<StoreProfileRecord[]> {
    try {
      return await prisma.storeProfile.findMany({
        select: { storeName: true, carpetSqft: true },
      });
    } catch (error) {
      mapPrismaError(error);
    }
  }
}

export function createPrismaStoreProfileRepository(): StoreProfileRepository {
  return instrumentObject(new PrismaStoreProfileRepository(), {
    namePrefix: "lfl.repository.storeProfile",
    captureResult: false,
  });
}
