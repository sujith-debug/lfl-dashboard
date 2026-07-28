import { z } from "zod";

/** Fully-qualified table id: `dataset.table` or `project.dataset.table`. */
export const BigQueryTableIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+){1,2}$/,
    "Table must look like dataset.table or project.dataset.table"
  );

export const AnalyticsDatasetDtoSchema = z.object({
  id: z.string(),
  location: z.string().optional(),
});
export type AnalyticsDatasetDto = z.infer<typeof AnalyticsDatasetDtoSchema>;

export const AnalyticsPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AnalyticsPreviewQuery = z.infer<typeof AnalyticsPreviewQuerySchema>;

export const AnalyticsPreviewDtoSchema = z.object({
  table: z.string(),
  jobId: z.string().optional(),
  totalRows: z.number().int().nonnegative(),
  rows: z.array(z.record(z.unknown())),
});
export type AnalyticsPreviewDto = z.infer<typeof AnalyticsPreviewDtoSchema>;

export const AnalyticsOverviewDtoSchema = z.object({
  projectId: z.string().nullable(),
  configured: z.boolean(),
  datasets: z.array(AnalyticsDatasetDtoSchema),
  sampleTable: z.string().nullable(),
  allowedTables: z.array(z.string()).default([]),
});
export type AnalyticsOverviewDto = z.infer<typeof AnalyticsOverviewDtoSchema>;
