import { z } from "zod";

export const ProjectStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type ProjectStatusDto = z.infer<typeof ProjectStatusSchema>;

/** Browser-safe project DTO — never leak Prisma types to the client. */
export const ProjectDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: ProjectStatusSchema,
  ownerId: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  description: z.string().trim().max(2000).optional().nullable(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: ProjectStatusSchema.optional(),
  /** Required for optimistic concurrency on updates. */
  version: z.number().int().positive(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const ListProjectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: ProjectStatusSchema.optional(),
  ownerId: z.string().optional(),
});
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export const ProjectListDtoSchema = z.object({
  items: z.array(ProjectDtoSchema),
  pagination: PaginationMetaSchema,
});
export type ProjectListDto = z.infer<typeof ProjectListDtoSchema>;
