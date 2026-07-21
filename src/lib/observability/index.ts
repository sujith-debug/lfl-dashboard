/**
 * App observability helpers. Prefer @foundry/logger instrument* wrappers
 * on repositories and services; use this module for shared span attribute keys.
 */
export const OBSERVABILITY = {
  FEATURE_PROJECTS: "projects",
} as const;
