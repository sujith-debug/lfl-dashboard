import "server-only";

/**
 * App-owned OPA action strings. Extend as features grow.
 * Built-in panel action remains available from @foundry/opa-client.
 */
export const APP_OPA_ACTIONS = {
  PROJECT_LIST: "project_list",
  PROJECT_READ: "project_read",
  PROJECT_CREATE: "project_create",
  PROJECT_UPDATE: "project_update",
  PROJECT_ARCHIVE: "project_archive",
} as const;

export type AppOpaAction =
  (typeof APP_OPA_ACTIONS)[keyof typeof APP_OPA_ACTIONS];
