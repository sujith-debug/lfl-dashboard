import { z } from "zod";
import { ValidationError } from "@/lib/db/errors";

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  message = "Validation failed"
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(message, result.error.flatten());
  }
  return result.data;
}

export { z };
