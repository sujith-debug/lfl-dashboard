"use client";

import { CreateProjectForm } from "@/modules/projects/components/CreateProjectForm";
import { ProjectList } from "@/modules/projects/components/ProjectList";
import { useProjects } from "@/modules/projects/hooks/useProjects";

/**
 * Client island: mutates via /api/v1/projects.
 * Server Components should call getProjectService() directly instead.
 */
export function ProjectsPanel() {
  const { projects, loading, error, createProject, refresh } = useProjects();

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Projects</h2>
      {loading ? <p>Loading projects…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      {!loading && !error ? <ProjectList projects={projects} /> : null}
      <div style={{ marginTop: "1.5rem" }}>
        <h3>Create</h3>
        <CreateProjectForm
          onCreate={createProject}
          onCreated={() => void refresh()}
        />
      </div>
    </section>
  );
}
