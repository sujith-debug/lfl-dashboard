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
    <section className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">Projects</h2>
          <p className="mt-1 text-sm text-slate-500">
            View and manage projects in this workspace.
          </p>
        </div>
        {loading ? (
          <p className="animate-pulse text-sm text-slate-500">
            Loading projects…
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {!loading && !error ? <ProjectList projects={projects} /> : null}
      </div>
      <div className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold">Create project</h2>
        <p className="mt-1 text-sm text-slate-500">
          Start a new project for your team.
        </p>
        <div className="mt-6">
        <CreateProjectForm
          onCreate={createProject}
          onCreated={() => void refresh()}
        />
        </div>
      </div>
    </section>
  );
}
