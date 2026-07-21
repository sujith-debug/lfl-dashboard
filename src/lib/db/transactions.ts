import "server-only";

import { instrumentFunction } from "@foundry/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type TransactionClient = Prisma.TransactionClient;

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

async function runTransaction(
  fn: (tx: TransactionClient) => Promise<unknown>,
  options?: TransactionOptions
): Promise<unknown> {
  return prisma.$transaction(fn, options);
}

const instrumentedRunTransaction = instrumentFunction(runTransaction as never, {
  name: "db.withTransaction",
  captureResult: false,
}) as typeof runTransaction;

/**
 * Run work inside a Prisma interactive transaction.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  return instrumentedRunTransaction(fn, options) as Promise<T>;
}
