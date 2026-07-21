"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CreateProjectInput,
  ProjectDto,
  ProjectListDto,
} from "../contracts";

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export function useProjects() {
  const [data, setData] = useState<ProjectListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/projects");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const json = (await response.json()) as ProjectListDto;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<ProjectDto> => {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const project = (await response.json()) as ProjectDto;
      await refresh();
      return project;
    },
    [refresh]
  );

  return {
    projects: data?.items ?? [],
    pagination: data?.pagination ?? null,
    loading,
    error,
    refresh,
    createProject,
  };
}
