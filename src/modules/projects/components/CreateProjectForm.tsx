"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
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
    <form onSubmit={handleSubmit} className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Project name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Customer portal"
          className="w-full rounded-lg border bg-white px-3.5 py-2.5 text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Slug
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          placeholder="customer-portal"
          className="w-full rounded-lg border bg-white px-3.5 py-2.5 font-mono text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What is this project for?"
          className="w-full resize-y rounded-lg border bg-white px-3.5 py-2.5 text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
