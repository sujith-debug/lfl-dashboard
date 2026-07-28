import { z } from "zod";

/** Fully-qualified table id: `dataset.table` or `project.dataset.table`. */
export const BigQueryTableIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+){1,2}$/,
    "Table must look like dataset.table or project.dataset.table"
  );

export const AnalyticsQueryInputSchema = z.object({
  table: BigQueryTableIdSchema,
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AnalyticsQueryInput = z.infer<typeof AnalyticsQueryInputSchema>;

export const AnalyticsQueryResultDtoSchema = z.object({
  table: z.string(),
  jobId: z.string().optional(),
  totalRows: z.number().int().nonnegative(),
  rows: z.array(z.record(z.unknown())),
});
export type AnalyticsQueryResultDto = z.infer<
  typeof AnalyticsQueryResultDtoSchema
>;
