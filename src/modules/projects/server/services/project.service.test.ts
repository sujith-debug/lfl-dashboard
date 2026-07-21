import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectService } from "./project.service";
import type { ProjectRepository } from "../repositories";
import type {
  CreateProjectData,
  ListProjectsFilter,
  ProjectRecord,
  UpdateProjectData,
} from "../models";

function makeRecord(
  overrides: Partial<ProjectRecord> = {}
): ProjectRecord {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alpha",
    slug: "alpha",
    description: null,
    status: "DRAFT",
    ownerId: "user-1",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class FakeProjectRepository implements ProjectRepository {
  private rows = new Map<string, ProjectRecord>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findBySlug(slug: string) {
    return [...this.rows.values()].find((row) => row.slug === slug) ?? null;
  }

  async list(filter: ListProjectsFilter) {
    let items = [...this.rows.values()];
    if (filter.ownerId) {
      items = items.filter((row) => row.ownerId === filter.ownerId);
    }
    if (filter.status) {
      items = items.filter((row) => row.status === filter.status);
    }
    const total = items.length;
    items = items.slice(filter.skip, filter.skip + filter.take);
    return { items, total };
  }

  async create(data: CreateProjectData) {
    const record = makeRecord({
      id: "22222222-2222-4222-8222-222222222222",
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      ownerId: data.ownerId,
      status: data.status ?? "DRAFT",
    });
    this.rows.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateProjectData) {
    const existing = this.rows.get(id);
    if (!existing || existing.version !== data.version) {
      return null;
    }
    const updated: ProjectRecord = {
      ...existing,
      name: data.name ?? existing.name,
      description:
        data.description !== undefined ? data.description : existing.description,
      status: data.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: new Date("2025-01-02T00:00:00.000Z"),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async softArchive(id: string, version: number) {
    return this.update(id, { status: "ARCHIVED", version });
  }
}

describe("ProjectService", () => {
  it("creates and lists projects", async () => {
    const service = new ProjectService(new FakeProjectRepository());
    const created = await service.create("user-1", {
      name: "Beta",
      slug: "beta",
      description: "demo",
    });

    assert.equal(created.slug, "beta");
    assert.equal(created.ownerId, "user-1");
    assert.equal(created.status, "DRAFT");

    const listed = await service.list({ ownerId: "user-1" });
    assert.equal(listed.pagination.total, 1);
    assert.equal(listed.items[0]?.slug, "beta");
  });

  it("rejects duplicate slugs", async () => {
    const service = new ProjectService(new FakeProjectRepository());
    await service.create("user-1", { name: "A", slug: "same" });

    await assert.rejects(
      () => service.create("user-1", { name: "B", slug: "same" }),
      /slug already exists/i
    );
  });

  it("enforces optimistic locking on update", async () => {
    const service = new ProjectService(new FakeProjectRepository());
    const created = await service.create("user-1", {
      name: "Lock",
      slug: "lock",
    });

    await assert.rejects(
      () =>
        service.update(created.id, {
          name: "Nope",
          version: created.version + 5,
        }),
      /modified by another request/i
    );
  });
});
