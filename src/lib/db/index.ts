import "server-only";

export { prisma } from "./prisma";
export type { PrismaClient } from "./prisma";
export {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  OptimisticLockError,
  mapPrismaError,
} from "./errors";
export { withTransaction } from "./transactions";
export type { TransactionClient } from "./transactions";
export { checkDatabaseHealth } from "./health";
export type { DbHealthStatus } from "./health";
export {
  normalizePagination,
  buildPaginatedResult,
} from "./pagination";
export type {
  PaginationInput,
  PaginationMeta,
  PaginatedResult,
} from "./pagination";
