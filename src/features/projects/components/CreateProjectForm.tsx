"use client";

import { useState, type FormEvent } from "react";
import type { CreateProjectInput, ProjectDto } from "../contracts";

type CreateProjectFormProps = {
  onCreate: (input: CreateProjectInput) => Promise<ProjectDto>;
  onCreated?: (project: ProjectDto) => void;
};

export function CreateProjectForm({
  onCreate,
  onCreated,
}: CreateProjectFormProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const project = await onCreate({
        name,
        slug,
        description: description || null,
      });
      setName("");
      setSlug("");
      setDescription("");
      onCreated?.(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}
    >
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ display: "block", width: "100%", marginTop: 4 }}
        />
      </label>
      <label>
        Slug
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          style={{ display: "block", width: "100%", marginTop: 4 }}
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ display: "block", width: "100%", marginTop: 4 }}
        />
      </label>
      {error ? <p style={{ color: "crimson", margin: 0 }}>{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
