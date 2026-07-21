import "server-only";

import type {
  CreateProjectData,
  ListProjectsFilter,
  ProjectRecord,
  UpdateProjectData,
} from "../models";

export interface ProjectRepository {
  findById(id: string): Promise<ProjectRecord | null>;
  findBySlug(slug: string): Promise<ProjectRecord | null>;
  list(filter: ListProjectsFilter): Promise<{
    items: ProjectRecord[];
    total: number;
  }>;
  create(data: CreateProjectData): Promise<ProjectRecord>;
  update(id: string, data: UpdateProjectData): Promise<ProjectRecord | null>;
  softArchive(id: string, version: number): Promise<ProjectRecord | null>;
}
