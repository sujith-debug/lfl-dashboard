import "server-only";

import { createPrismaProjectRepository } from "./repositories";
import { createProjectService, type ProjectService } from "./services";

let projectService: ProjectService | null = null;

/**
 * Instrumented feature singletons. Prefer this over importing Prisma in routes.
 */
export function getProjectService(): ProjectService {
  if (!projectService) {
    const repository = createPrismaProjectRepository();
    projectService = createProjectService(repository);
  }
  return projectService;
}

/** Test helper to inject a fake repository-backed service. */
export function __setProjectServiceForTests(service: ProjectService | null): void {
  projectService = service;
}
