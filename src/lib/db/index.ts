import "server-only";

export { prisma } from "./prisma";
export type { PrismaClient } from "./prisma";

export {
  mapPrismaError,
  withTransaction,
  checkDatabaseHealth,
} from "@foundry/prisma";
export type { TransactionClient, DbHealthStatus } from "@foundry/prisma";

export {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  OptimisticLockError,
  normalizePagination,
  buildPaginatedResult,
} from "@foundry/api-core";
export type {
  PaginationInput,
  PaginationMeta,
  PaginatedResult,
} from "@foundry/api-core";
