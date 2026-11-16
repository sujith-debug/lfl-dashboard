import "server-only";

import { AppError } from "@foundry/api-core";
import { logger } from "@foundry/logger";
import { AskInputSchema, type AskAnswerDto, type GroupRowDto, type LflDashboardDto, type Pair } from "../../contracts";
import { parseOrThrow } from "@/lib/validation";
import type { LflService } from "./lfl.service";
import { askClaude, CLAUDE_MODEL, sqlRunner, type ClaudeAskConfig } from "./lfl-ask-claude";

/**
 * "Ask the data": answers questions about the dashboard view the user is
 * looking at, through one of two providers:
 * - "claude" (ANTHROPIC_API_KEY set): Claude sees the view and can run
 *   read-only SQL on the feed tables (see lfl-ask-claude.ts)
 * - "openai" (LFL_ASK_URL set): any OpenAI-compatible chat endpoint (LiteLLM,
 *   OpenAI, Ollama); it only sees the numbers for the view and can't query
 */
export type AskConfig =
  | { provider: "openai"; url: string; apiKey: string | null; model: string; timeoutMs: number }
  | ({ provider: "claude" } & ClaudeAskConfig);

export function askConfigFromEnv(env: Record<string, string | undefined> = process.env): AskConfig | null {
  const provider = env.LFL_ASK_PROVIDER?.trim().toLowerCase();
  const url = env.LFL_ASK_URL?.trim();
  if (provider === "claude" || (provider !== "openai" && env.ANTHROPIC_API_KEY?.trim())) {
    return {
      provider: "claude",
      // Null lets the SDK find credentials itself (ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile).
      apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
      model: env.LFL_ASK_MODEL?.trim() || CLAUDE_MODEL,
      timeoutMs: Number(env.LFL_ASK_TIMEOUT_MS) || 180_000,
    };
  }
  if (!url) return null;
  return {
    provider: "openai",
    url: url.replace(/\/+$/, ""),
    apiKey: env.LFL_ASK_API_KEY?.trim() || null,
    model: env.LFL_ASK_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs: Number(env.LFL_ASK_TIMEOUT_MS) || 60_000,
  };
}

const SYSTEM_PROMPT = `You answer questions about GIVA's offline store like-for-like (LFL) dashboard.
Use only the data provided below. If the answer isn't in it, say so and suggest which filter or tab would show it.
Definitions:
- LFL growth = this year (TY) / last year (LY) - 1, comparing the same days a year earlier.
- A store is LFL when its first order is more than 365 days before the start of the range.
- NOB = number of bills. SKU = units sold. Conversion = bills on days with footfall / footfall.
- Sales are net of exchanges/returns, discounts and promos, excluding 3% GST. Amounts are in rupees; write them as ₹ with lakh (L) or crore (Cr).
Answer in short plain English for a retail manager: lead with the answer, then at most 5 bullets of supporting numbers. No tables wider than 4 columns. Never invent stores or numbers.`;

const r0 = (n: number) => Math.round(n);
/** Only the filters that are set, for the context header. */
const compact = (filters: unknown) =>
  Object.fromEntries(Object.entries((filters ?? {}) as Record<string, unknown>).filter(([, v]) => v != null && v !== ""));
const pair = (p: Pair) => `${r0(p.ty)}/${r0(p.ly)}`;
const groups = (title: string, rows: GroupRowDto[]) =>
  [`## ${title} (name | stores | sales TY/LY | gold TY/LY | silver TY/LY | bills TY/LY | units TY/LY)`]
    .concat(rows.map((g) => [g.comparable === false ? `${g.key} (new stores, no fair LY base)` : g.key, g.stores, pair(g.sales), pair(g.gold), pair(g.silver), pair(g.bills), g.units ? pair(g.units) : "-"].join(" | ")))
    .join("\n");

/** The dashboard as compact text: every number the tabs show, nothing more. */
export function askContext(d: LflDashboardDto, filters: unknown = {}): string {
  const t = d.totals;
  const f = d.meta;
  const parts = [
    `# View: ${f.from} to ${f.to} vs ${f.lyFrom} to ${f.lyTo}. Filters: ${JSON.stringify(filters)}`,
    `## Totals (TY/LY): sales ${pair(t.sales)}, gold ${pair(t.gold)}, silver ${pair(t.silver)}, bills ${pair(t.bills)}, gold bills ${pair(t.goldBills)}, silver bills ${pair(t.silverBills)}, gold qty ${pair(t.goldUnits)}, silver qty ${pair(t.silverUnits)}, footfall ${pair(t.footfall)}, bills on footfall days ${pair(t.billsWithFootfall)}, LFL stores ${pair(t.stores)}`,
    groups("Regions", d.regions),
    groups("Sub-regions", d.subregions),
    groups("Cities", d.cities),
    groups("Store age (all stores, LFL and new)", d.ages),
    groups("Area managers", d.ams),
  ];
  if (d.mix.connected) {
    parts.push(
      `## Gold by karat (sales TY/LY, units TY/LY)\n${d.gold.map((g) => `${g.label} | ${pair(g.sales)} | ${pair(g.units)}`).join("\n")}`,
      `## Silver classic vs non-classic\n${d.silver.map((g) => `${g.label} | ${pair(g.sales)} | ${pair(g.units)}`).join("\n")}`,
      `## Categories (sales TY/LY | units TY/LY | stock TY/LY)\n${d.categories.all
        .map((c) => `${c.label} | ${pair(c.sales)} | ${pair(c.units)} | ${c.inventory ? pair(c.inventory) : "-"}`)
        .join("\n")}`
    );
  }
  const c = d.concerns;
  parts.push(
    `## Concern stores: revenue LFL per month, ${c.basis.toUpperCase()} ${c.from} to ${c.to} (months: ${c.months.join(", ")})\n` +
      c.rows
        .slice(0, 60)
        .map((r) => `${r.name} | down ${r.degrowingMonths} months | ${r.months.map((m) => (m.lfl == null ? "-" : `${(m.lfl * 100).toFixed(0)}%`)).join(" ")} | YTD ${pair(r.ytd)}`)
        .join("\n")
  );
  parts.push(
    "## Stores (name | city | region | AM | age | type | LFL? | sqft | sales TY/LY | gold TY/LY | silver TY/LY | bills TY/LY | footfall TY/LY | stock TY/LY)\n" +
      d.allStores
        .map((s) =>
          [s.name, s.city, s.region, s.am, s.age, s.type, s.isLfl ? "LFL" : "new", s.sqft ?? "-", pair(s.sales), pair(s.gold), pair(s.silver), pair(s.bills), pair(s.footfall), s.inventory ? pair(s.inventory) : "-"].join(" | ")
        )
        .join("\n")
  );
  if (d.inventory.connected && d.inventory.total) parts.push(`## Stock on hand ${d.inventory.asOf} vs ${d.inventory.lyAsOf}: ${pair(d.inventory.total)}`);
  if (d.staff.connected) parts.push(`## Staff: ${d.staff.headcount} active, average tenure ${d.staff.avgTenureMonths?.toFixed(1)} months`);
  return parts.join("\n\n");
}

export class LflAskService {
  constructor(
    private readonly lfl: LflService,
    private readonly config: AskConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly runSql = config?.provider === "claude" ? sqlRunner() : null
  ) {}

  get enabled(): boolean {
    return this.config != null;
  }

  async ask(filters: unknown, body: unknown): Promise<AskAnswerDto> {
    const config = this.config;
    if (!config) throw new AppError("Ask the data isn't set up. Set ANTHROPIC_API_KEY (or LFL_ASK_URL).", "ASK_DISABLED", 503);
    const { question, history } = parseOrThrow(AskInputSchema, body);
    const dashboard = await this.lfl.getDashboard(filters);
    if (config.provider === "claude") {
      return askClaude(config, { question, history: history ?? [], context: askContext(dashboard, compact(filters)), today: dashboard.meta.to }, this.runSql ?? sqlRunner());
    }

    const response = await this.fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${askContext(dashboard, compact(filters))}` },
          ...(history ?? []),
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    }).catch((error: unknown) => {
      // The detail (often the internal host name) goes to the log, not to the browser.
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, "LFL ask: AI service unreachable");
      throw new AppError("Couldn't reach the AI service. Try again in a minute.", "ASK_UNREACHABLE", 502);
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "LFL ask: AI service error");
      throw new AppError(`The AI service answered ${response.status}.`, "ASK_UPSTREAM", 502);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new AppError("The AI service sent an empty answer.", "ASK_EMPTY", 502);
    return { answer };
  }
}

export const createLflAskService = (lfl: LflService, config: AskConfig | null) => new LflAskService(lfl, config);
