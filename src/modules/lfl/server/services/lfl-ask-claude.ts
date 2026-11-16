import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError } from "@foundry/api-core";
import { getAllowedDatasetsTables } from "@foundry/bigquery";
import { logger } from "@foundry/logger";
import { z } from "zod/v4";
import type { AskAnswerDto } from "../../contracts";
import { lflDailySql } from "../ingest/feed-sql";
import { fetchFeed as fetchBigQuery } from "../ingest/bigquery-feed";
import type { FetchFeed } from "../ingest/sync.service";
import { MAX_ROWS, readOnlySql } from "./ask-sql";

/**
 * "Ask the data" on Claude: the model gets the numbers on screen and one
 * tool, run_sql, for read-only BigQuery SQL on the feed tables (with the app's
 * service account, as the board's own queries). That lets it answer
 * questions the board doesn't show, while ask-sql.ts keeps every query
 * read-only, on allowlisted tables and capped at MAX_ROWS rows.
 */

export const CLAUDE_MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;
/** Characters of query result handed back to the model per call. */
const MAX_RESULT_CHARS = 30_000;

/** Stable across requests (no dates, no view), so the prompt cache holds it. */
const SYSTEM_PROMPT = `You are the analyst behind GIVA's offline store like-for-like (LFL) board. GIVA is an Indian D2C jewellery brand (gold and 925 silver) with ~270 exclusive brand outlets (EBOs). Store managers, area managers and leadership ask you questions.

How to answer:
- First use the <current_view> numbers in the user's message: they are exactly what the board shows for the dates and filters on screen. Only query when the view can't answer (another period, a single SKU or category, a day, a salesperson, hours, a store comparison the view lacks).
- When you query, use the run_sql tool: one BigQuery SELECT per call, only on the tables below, results capped at ${MAX_ROWS} rows (aggregate in SQL; never pull raw lines to count them yourself). Prefer one or two well-aggregated queries over many small ones.
- Lead with the answer in a sentence, then up to 5 short bullets of supporting numbers. Amounts in rupees as ₹ with lakh (L) or crore (Cr). Say which dates you used. If you queried, say so in a few words. Never invent stores or numbers; if the data can't answer, say what's missing.
- Correlation is not cause: say "goes with", not "drives", unless the data shows the mechanism.

Business definitions (the board and GIVA's "LFL Metrics Main" report #8734 use exactly these):
- Net sales = sale-line net_sales + exchange/return-line net_sales (negative) - promo_wallet_allocated on sale lines, then ÷ 1.03 (ex-GST). Gold = SKUs starting 'GD'; everything else is silver. Exchange/return lines with a NULL sku count as gold.
- NOB (bills) = COUNT(DISTINCT order_id) on type = 'sale' lines; gold NOB / silver NOB = distinct sale orders with a gold / silver SKU.
- Qty = SUM(quantity) on sale lines. ASP = sale-line net_sales (before E/R and promo, not ÷1.03) ÷ qty.
- Footfall: givametabse.tangoeye_data, hours 10-23, highest count per store/hour/day; a day with > 100 minutes of camera downtime between 11:00 and 20:59 counts as 0 footfall. Conversion = bills on days with footfall ÷ footfall.
- LFL store: first order more than 365 days before the period start. LY = the same dates 365 days earlier. Store-days with no positive sales are left out.
- Days are DATE(created_at) as stored (the board does the same).

Tables (dataset.table; only these exist for you):
- intermediary.ebo_all_data: one row per EBO order line. type ('sale', or exchange/return types), created_at TIMESTAMP, order_id, line_item_id, sku, quantity, location_name (store name), gross_price, discount, promo_wallet_allocated, net_sales, sku_category (category name, e.g. Earrings, Rings).
- raw_postgres_giva_db.offline_stores: store master. JSON_EXTRACT_SCALAR(data, '$.name') is the store name (matches location_name), location_id, Region, City, area_manager_email, mall_hs ('Mall'/'HS'), store_type, live_status, live_date and store_closure_date (epoch millis), tangoeye_store_id, latitude, longitude. Exclude names LIKE '%test%', 'Offline%', 'Franchise%'.
- raw_postgres_giva_db.offline_staff: POS staff. id, name, staff_type ('fc','sfc','sm','asm','ssm'), store_location_id (= offline_stores.location_id as STRING), created_at (epoch millis, when added to the POS; records start Feb 2025), handover_done (true = left), updated_at.
- raw_postgres_giva_db.order_stores: order_name (= ebo_all_data.order_id), staff_breakdown (JSON with the salesperson), created_at.
- raw_postgres_giva_db.mto_orders_new: made-to-order (MTO) orders. name, sku, final_order_name (= ebo_all_data.order_id once billed), created_at (epoch millis), amount_received (advance), size (JSON: carat, color, diameter), timeline (JSON array of {status}). Almost all are gold.
- givametabse.orders: all orders incl. online; location_id, created_at. Used for a store's first order date.
- givametabse.tangoeye_data: date_string, HOUR, store_id (= offline_stores.tangoeye_store_id), footfall_count, down_time (minutes).
- airbyte.shopify_products (id, tags, updated_at) and airbyte.shopify_product_variants (sku, product_id): karat from REGEXP_EXTRACT(LOWER(tags), r'carat_([0-9]+)k'); silver "classic" when tags contain subcategory_classic.
- guts.inventory_daily_snapshot: snapshot_timestamp, sku, ebo_location_quantities (ARRAY<STRUCT<location_name, quantity>>; UNNEST it). Stock on a day = latest snapshot that day (IST). Starts 24 Apr 2026.

Reference: the board's daily query (store x day, TY and LY), for exact formulas:
${lflDailySql("2026-09-01", "2026-09-30")}`;

type RunSql = (sql: string) => Promise<{ rows: Record<string, unknown>[]; truncated: boolean } | { error: string }>;

export function sqlRunner(fetchFeed: FetchFeed = fetchBigQuery): RunSql {
  const allowlist = getAllowedDatasetsTables();
  return async (sql) => {
    const check = readOnlySql(sql, allowlist);
    if (!check.ok) return { error: check.reason };
    try {
      const rows = await fetchFeed(check.sql, "ask");
      return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
    } catch (error) {
      return { error: (error instanceof Error ? error.message : String(error)).slice(0, 600) };
    }
  };
}

export type ClaudeAskConfig = { apiKey: string | null; model: string; timeoutMs: number };

export async function askClaude(
  config: ClaudeAskConfig,
  input: { question: string; history: { role: "user" | "assistant"; content: string }[]; context: string; today: string },
  runSql: RunSql,
  client = new Anthropic({ apiKey: config.apiKey ?? undefined, timeout: config.timeoutMs, maxRetries: 1 })
): Promise<AskAnswerDto> {
  const queries: NonNullable<AskAnswerDto["queries"]> = [];
  const tool = betaZodTool({
    name: "run_sql",
    description: `Run one read-only BigQuery SQL query (SELECT or WITH) on the GIVA tables in the system prompt and get the rows back as JSON (at most ${MAX_ROWS}). Aggregate in SQL. A rejected query or BigQuery error comes back as {"error": ...}: fix the query and try again.`,
    inputSchema: z.object({
      sql: z.string().describe("A single BigQuery Standard SQL SELECT / WITH query, no trailing semicolon"),
      purpose: z.string().describe("A few words on what this query finds, shown to the user"),
    }),
    run: async ({ sql, purpose }) => {
      const result = await runSql(sql);
      queries.push({ purpose, sql, rows: "rows" in result ? result.rows.length : null, error: "error" in result ? result.error : null });
      logger.info({ purpose, rows: "rows" in result ? result.rows.length : null, failed: "error" in result }, "LFL ask: query");
      return JSON.stringify(result).slice(0, MAX_RESULT_CHARS);
    },
  });

  // History first (plain text), then this turn with the view; the system prompt stays byte-stable for caching.
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `<current_view>\nThe board's dates end on ${input.today} (the latest complete day unless the user picked other dates).\n${input.context}\n</current_view>\n\n${input.question}`,
    },
  ];

  try {
    const final = await client.beta.messages
      .toolRunner({
        model: config.model,
        max_tokens: 16000,
        max_iterations: MAX_TOOL_ROUNDS,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [tool],
        messages,
      })
      .runUntilDone();

    if (final.stop_reason === "refusal") {
      throw new AppError("The AI declined to answer that. Try rephrasing the question.", "ASK_REFUSED", 422);
    }
    const answer = final.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!answer) {
      throw new AppError(
        final.stop_reason === "tool_use" ? "That needed more queries than allowed. Try a narrower question." : "The AI sent an empty answer.",
        "ASK_EMPTY",
        502
      );
    }
    logger.info(
      { model: final.model, queries: queries.length, cacheRead: final.usage.cache_read_input_tokens, input: final.usage.input_tokens, output: final.usage.output_tokens },
      "LFL ask answered"
    );
    return { answer, queries };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The Claude API key was rejected. Check ANTHROPIC_API_KEY.", "ASK_AUTH", 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("Claude is busy right now. Try again in a minute.", "ASK_RATE_LIMIT", 503);
    }
    if (error instanceof Anthropic.APIError) {
      logger.warn({ status: error.status, err: error.message }, "LFL ask: Claude API error");
      throw new AppError(`The AI service answered ${error.status ?? "with an error"}.`, "ASK_UPSTREAM", 502);
    }
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "LFL ask: Claude unreachable");
    throw new AppError("Couldn't reach the AI service. Try again in a minute.", "ASK_UNREACHABLE", 502);
  }
}
