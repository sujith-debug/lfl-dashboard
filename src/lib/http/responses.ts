import { NextResponse } from "next/server";
import { AppError } from "@/lib/db/errors";
import { logger } from "@foundry/logger";

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function jsonCreated<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status }
    );
  }

  logger.error("Unhandled API error", { error });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    },
    { status: 500 }
  );
}
