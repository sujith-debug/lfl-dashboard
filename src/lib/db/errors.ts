import { Prisma } from "@prisma/client";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} not found: ${id}` : `${resource} not found`,
      "NOT_FOUND",
      404
    );
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFLICT", 409, details);
    this.name = "ConflictError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class OptimisticLockError extends AppError {
  constructor(resource: string) {
    super(
      `${resource} was modified by another request; refresh and retry`,
      "OPTIMISTIC_LOCK",
      409
    );
    this.name = "OptimisticLockError";
  }
}

/**
 * Map Prisma client errors to stable app errors for API responses.
 */
export function mapPrismaError(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta?.target as string[]).join(", ")
          : String(error.meta?.target ?? "field");
        throw new ConflictError(`Unique constraint failed on ${target}`, {
          prismaCode: error.code,
          target,
        });
      }
      case "P2025":
        throw new NotFoundError("Record");
      case "P2003":
        throw new ValidationError("Related record not found", {
          prismaCode: error.code,
        });
      default:
        throw new AppError(
          "Database request failed",
          "DATABASE_ERROR",
          500,
          { prismaCode: error.code }
        );
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    throw new ValidationError("Invalid database query", {
      message: error.message,
    });
  }

  throw error instanceof Error
    ? error
    : new AppError("Unexpected database error", "DATABASE_ERROR", 500);
}
