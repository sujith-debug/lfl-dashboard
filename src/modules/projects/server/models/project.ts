import "server-only";

import type { Prisma, ProjectStatus } from "@prisma/client";
/** Explicit Prisma select — keep query shape intentional. */
export const projectSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  ownerId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

export type ProjectRecord = Prisma.ProjectGetPayload<{
  select: typeof projectSelect;
}>;

export type ProjectStatusValue = ProjectStatus;

export type CreateProjectData = {
  name: string;
  slug: string;
  description?: string | null;
  ownerId: string;
  status?: ProjectStatusValue;
};

export type UpdateProjectData = {
  name?: string;
  description?: string | null;
  status?: ProjectStatusValue;
  version: number;
};

export type ListProjectsFilter = {
  ownerId?: string;
  status?: ProjectStatusValue;
  skip: number;
  take: number;
};
