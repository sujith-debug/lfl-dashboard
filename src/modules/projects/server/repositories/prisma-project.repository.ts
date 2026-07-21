import "server-only";

import { instrumentObject } from "@foundry/logger";
import { mapPrismaError } from "@foundry/prisma";
import { prisma } from "@/lib/db/prisma";
import {
  projectSelect,
  type CreateProjectData,
  type ListProjectsFilter,
  type ProjectRecord,
  type UpdateProjectData,
} from "../models";
import type { ProjectRepository } from "./project.repository";

class PrismaProjectRepository implements ProjectRepository {
  async findById(id: string): Promise<ProjectRecord | null> {
    try {
      return await prisma.project.findUnique({
        where: { id },
        select: projectSelect,
      });
    } catch (error) {
      mapPrismaError(error);
    }
  }

  async findBySlug(slug: string): Promise<ProjectRecord | null> {
    try {
      return await prisma.project.findUnique({
        where: { slug },
        select: projectSelect,
      });
    } catch (error) {
      mapPrismaError(error);
    }
  }

  async list(
    filter: ListProjectsFilter
  ): Promise<{ items: ProjectRecord[]; total: number }> {
    try {
      const where = {
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.project.findMany({
          where,
          select: projectSelect,
          orderBy: { createdAt: "desc" },
          skip: filter.skip,
          take: filter.take,
        }),
        prisma.project.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      mapPrismaError(error);
    }
  }

  async create(data: CreateProjectData): Promise<ProjectRecord> {
    try {
      return await prisma.project.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          ownerId: data.ownerId,
          status: data.status ?? "DRAFT",
        },
        select: projectSelect,
      });
    } catch (error) {
      mapPrismaError(error);
    }
  }

  async update(
    id: string,
    data: UpdateProjectData
  ): Promise<ProjectRecord | null> {
    try {
      const result = await prisma.project.updateMany({
        where: { id, version: data.version },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        return null;
      }

      return await this.findById(id);
    } catch (error) {
      mapPrismaError(error);
    }
  }

  async softArchive(
    id: string,
    version: number
  ): Promise<ProjectRecord | null> {
    return this.update(id, { status: "ARCHIVED", version });
  }
}

export function createPrismaProjectRepository(): ProjectRepository {
  return instrumentObject(new PrismaProjectRepository(), {
    namePrefix: "projects.repository",
    captureResult: false,
  });
}
