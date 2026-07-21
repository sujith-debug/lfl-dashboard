import "server-only";

import type { ProjectDto } from "../../contracts";
import type { ProjectRecord } from "../models";

export function toProjectDto(record: ProjectRecord): ProjectDto {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    status: record.status,
    ownerId: record.ownerId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
