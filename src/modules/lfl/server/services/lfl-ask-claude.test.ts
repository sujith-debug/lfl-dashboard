import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { askClaude } from "./lfl-ask-claude";

/** A stand-in Messages API: first asks to run SQL, then answers with what came back. */
const bodies: { model: string; system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: unknown }[] }[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    bodies.push(body);
    const last = body.messages.at(-1);
    const toolResult = Array.isArray(last.content) ? last.content.find((b: { type: string }) => b.type === "tool_result") : null;
    const message = (content: unknown[], stop_reason: string) => ({
      id: `msg_${bodies.length}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    res.writeHead(200, { "content-type": "application/json" });
    if (!toolResult) {
      return res.end(
        JSON.stringify(
          message([{ type: "tool_use", id: "tu_1", name: "run_sql", input: { sql: "SELECT 1 AS n FROM intermediary.ebo_all_data", purpose: "count" } }], "tool_use")
        )
      );
    }
    const text = typeof toolResult.content === "string" ? toolResult.content : toolResult.content[0].text;
    res.end(JSON.stringify(message([{ type: "text", text: `The query said ${text}` }], "end_turn")));
  });
});

describe("Ask the data on Claude", () => {
  let client: Anthropic;
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxRetries: 0 });
  });
  after(() => server.close());

  it("runs the SQL the model asks for, feeds back the rows, and lists the query with the answer", async () => {
    const ran: string[] = [];
    const result = await askClaude(
      { apiKey: "test", model: "claude-opus-5-5", timeoutMs: 5000 },
      { question: "How many lines?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], context: "## Totals", today: "2026-10-29" },
      async (sql) => {
        ran.push(sql);
        return { rows: [{ n: 42 }], truncated: false };
      },
      client
    );
    assert.deepEqual(ran, ["SELECT 1 AS n FROM intermediary.ebo_all_data"]);
    assert.match(result.answer, /"n":42/);
    assert.deepEqual(result.queries, [{ purpose: "count", sql: "SELECT 1 AS n FROM intermediary.ebo_all_data", rows: 1, error: null }]);
    // The table guide goes in a cached system block; the view goes in the user turn. (Later rounds continue
    // the runner's server-side thread, so they don't resend the system prompt.)
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!.model, "claude-opus-5-5");
    assert.ok(bodies[0]!.system[0]!.cache_control);
    assert.match(bodies[0]!.system[0]!.text, /intermediary\.ebo_all_data/);
    assert.match(String(bodies[0]!.messages[2]!.content), /<current_view>[\s\S]*## Totals[\s\S]*How many lines\?$/);
  });
});
