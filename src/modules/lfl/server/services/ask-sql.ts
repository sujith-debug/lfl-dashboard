import "server-only";

import { isTableAllowed, type AllowedTablePattern } from "@foundry/bigquery";

/**
 * Guards the SQL "Ask the data" lets the model run: one read-only statement
 * (SELECT or WITH), only on allowlisted tables, with a row cap. The service
 * account may read more than the dashboard needs; this keeps the model on the
 * same tables the feeds use (BQ_ALLOWED_DATASETS_TABLES).
 */

export const MAX_ROWS = 200;

const WRITE_WORDS =
  /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|call|export|execute|declare|begin|commit|rollback|load|set)\b/i;

/** Text with comments and string / quoted-identifier contents blanked, so keyword checks don't trip on data. */
function blankLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*|#[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

/** dataset.table / project.dataset.table names after FROM or JOIN (CTE names have no dot and are skipped). */
export function referencedTables(sql: string): string[] {
  const text = blankLiterals(sql);
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:from|join)\s+`?([\w-]+(?:\.[\w-]+){1,2})`?/gi)) out.add(m[1]!);
  return [...out];
}

export type SqlCheck = { ok: true; sql: string } | { ok: false; reason: string };

export function readOnlySql(raw: string, allowlist: AllowedTablePattern[]): SqlCheck {
  const sql = raw.trim().replace(/;\s*$/, "");
  const text = blankLiterals(sql);
  if (!/^\s*(select|with)\b/i.test(text)) return { ok: false, reason: "Only a single SELECT (or WITH … SELECT) query is allowed." };
  if (text.includes(";")) return { ok: false, reason: "Only one statement per query." };
  const write = text.match(WRITE_WORDS);
  if (write) return { ok: false, reason: `"${write[1]}" isn't allowed: queries are read-only.` };
  if (/information_schema/i.test(text)) return { ok: false, reason: "Schema tables aren't available; the system prompt lists the tables and columns." };
  const blocked = referencedTables(sql).filter((t) => !isTableAllowed(t, allowlist));
  if (blocked.length) return { ok: false, reason: `Not an allowed table: ${blocked.join(", ")}. Use only the tables in the system prompt.` };
  return { ok: true, sql: `SELECT * FROM (\n${sql}\n) LIMIT ${MAX_ROWS + 1}` };
}
