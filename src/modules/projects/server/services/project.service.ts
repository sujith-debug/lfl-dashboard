import "server-only";

import {
  buildPaginatedResult,
  normalizePagination,
  NotFoundError,
  OptimisticLockError,
  ConflictError,
  parseOrThrow,
  type PaginatedResult,
} from "@foundry/api-core";
import { instrumentObject } from "@foundry/logger";
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  ListProjectsQuerySchema,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ProjectDto,
} from "../../contracts";
import type { ProjectRepository } from "../repositories";
import { toProjectDto } from "./project.mapper";

export class ProjectService {
  constructor(private readonly projects: ProjectRepository) {}

  async list(query: unknown = {}): Promise<PaginatedResult<ProjectDto>> {
    const parsed = parseOrThrow(ListProjectsQuerySchema, query);
    const { page, pageSize, skip, take } = normalizePagination(parsed);
    const { items, total } = await this.projects.list({
      ownerId: parsed.ownerId,
      status: parsed.status,
      skip,
      take,
    });
    return buildPaginatedResult(
      items.map(toProjectDto),
      total,
      page,
      pageSize
    );
  }

  async getById(id: string): Promise<ProjectDto> {
    const project = await this.projects.findById(id);
    if (!project) {
      throw new NotFoundError("Project", id);
    }
    return toProjectDto(project);
  }

  async create(
    ownerId: string,
    input: CreateProjectInput
  ): Promise<ProjectDto> {
    const data = parseOrThrow(CreateProjectInputSchema, input);

    const existing = await this.projects.findBySlug(data.slug);
    if (existing) {
      throw new ConflictError(`Project slug already exists: ${data.slug}`);
    }

    const created = await this.projects.create({
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      ownerId,
    });
    return toProjectDto(created);
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const data = parseOrThrow(UpdateProjectInputSchema, input);
    const existing = await this.projects.findById(id);
    if (!existing) {
      throw new NotFoundError("Project", id);
    }

    const updated = await this.projects.update(id, {
      name: data.name,
      description: data.description,
      status: data.status,
      version: data.version,
    });

    if (!updated) {
      throw new OptimisticLockError("Project");
    }

    return toProjectDto(updated);
  }

  async archive(id: string, version: number): Promise<ProjectDto> {
    const existing = await this.projects.findById(id);
    if (!existing) {
      throw new NotFoundError("Project", id);
    }

    const archived = await this.projects.softArchive(id, version);
    if (!archived) {
      throw new OptimisticLockError("Project");
    }

    return toProjectDto(archived);
  }
}

export function createProjectService(
  repository: ProjectRepository
): ProjectService {
  return instrumentObject(new ProjectService(repository), {
    namePrefix: "projects.service",
    captureResult: false,
  });
}
