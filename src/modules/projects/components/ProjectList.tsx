"use client";

import type { ProjectDto } from "../contracts";

type ProjectListProps = {
  projects: ProjectDto[];
  onSelect?: (project: ProjectDto) => void;
};

export function ProjectList({ projects, onSelect }: ProjectListProps) {
  if (projects.length === 0) {
    return <p>No projects yet.</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {projects.map((project) => (
        <li
          key={project.id}
          style={{
            padding: "0.75rem 0",
            borderBottom: "1px solid #e5e5e5",
          }}
        >
          <button
            type="button"
            onClick={() => onSelect?.(project)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: onSelect ? "pointer" : "default",
              font: "inherit",
            }}
          >
            <strong>{project.name}</strong>
            <span style={{ color: "#666", marginLeft: "0.5rem" }}>
              ({project.slug})
            </span>
            <div style={{ fontSize: "0.875rem", color: "#888" }}>
              {project.status}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
