"use client";

import type { ProjectDto } from "../contracts";

type ProjectListProps = {
  projects: ProjectDto[];
  onSelect?: (project: ProjectDto) => void;
};

export function ProjectList({ projects, onSelect }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-slate-50 px-5 py-10 text-center">
        <p className="font-medium text-slate-700">No projects yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Create your first project to get started.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {projects.map((project) => (
        <li key={project.id} className="py-1 first:pt-0 last:pb-0">
          <button
            type="button"
            onClick={() => onSelect?.(project)}
            className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left ${
              onSelect ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">
                {project.name}
              </p>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {project.slug}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold capitalize text-emerald-700">
              {project.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
