import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LflAskService, askConfigFromEnv, askContext } from "./lfl-ask.service";
import type { LflService } from "./lfl.service";
import type { LflDashboardDto } from "../../contracts";

const pair = (ty: number, ly: number) => ({ ty, ly });
const group = (key: string) => ({ key, stores: 1, sales: pair(110, 100), gold: pair(10, 10), silver: pair(100, 90), bills: pair(5, 4), units: null });
const dashboard = {
  meta: { from: "2026-10-01", to: "2026-10-07", lyFrom: "2025-10-01", lyTo: "2025-10-07" },
  totals: { sales: pair(110, 100), gold: pair(10, 10), silver: pair(100, 90), bills: pair(5, 4), goldBills: pair(1, 1), footfall: pair(50, 40), billsWithFootfall: pair(5, 4), stores: pair(1, 1), silverBills: pair(4, 3), goldUnits: pair(1, 1), silverUnits: pair(8, 7), goldLineSales: pair(12, 12), silverLineSales: pair(110, 100) },
  regions: [group("South")],
  subregions: [group("S1")],
  cities: [group("Bengaluru")],
  ages: [group("3+ yrs")],
  ams: [group("Asha")],
  concerns: { basis: "ytd", from: "2026-01-01", to: "2026-10-07", months: ["2026-10"], rows: [] },
  mix: { connected: false },
  gold: [],
  silver: [],
  categories: { all: [], gold: [], silver: [] },
  inventory: { connected: false, asOf: null, lyAsOf: null, total: null },
  staff: { connected: false, headcount: 0, avgTenureMonths: null },
  allStores: [
    { id: "1", name: "Mall One", city: "Bengaluru", region: "South", am: "Asha", age: "3+ yrs", type: "Mall", sqft: 400, isLfl: true, sales: pair(110, 100), gold: pair(10, 10), silver: pair(100, 90), bills: pair(5, 4), footfall: pair(50, 40), inventory: null },
  ],
} as unknown as LflDashboardDto;

const lfl = { getDashboard: async () => dashboard } as unknown as LflService;

describe("LflAskService", () => {
  it("is off unless a Claude key or an OpenAI-compatible URL is set; Claude wins when both are", () => {
    assert.equal(askConfigFromEnv({}), null);
    assert.equal(new LflAskService(lfl, null).enabled, false);
    const openai = askConfigFromEnv({ LFL_ASK_URL: "http://llm/v1/" });
    assert.equal(openai?.provider === "openai" && openai.url, "http://llm/v1");
    const claude = askConfigFromEnv({ ANTHROPIC_API_KEY: "sk-ant-x", LFL_ASK_URL: "http://llm/v1" });
    assert.deepEqual([claude?.provider, claude?.model], ["claude", "claude-opus-5-5"]);
    assert.equal(askConfigFromEnv({ ANTHROPIC_API_KEY: "sk-ant-x", LFL_ASK_PROVIDER: "openai", LFL_ASK_URL: "http://llm" })?.provider, "openai");
  });

  it("describes the view as compact text with every store", () => {
    const text = askContext(dashboard, { region: "South" });
    assert.ok(text.includes('Filters: {"region":"South"}'));
    assert.ok(text.includes("Mall One | Bengaluru | South | Asha"));
    assert.ok(text.includes("## Cities"));
  });

  it("sends the question with the view to an OpenAI-compatible endpoint", async () => {
    let sent: { url: string; body: { model: string; messages: { role: string; content: string }[] }; auth: string | null } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ choices: [{ message: { content: "Revenue is up 10%." } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const service = new LflAskService(lfl, { provider: "openai", url: "http://llm/v1", apiKey: "k", model: "m", timeoutMs: 1000 }, fakeFetch);

    const result = await service.ask({}, { question: "How is revenue?", history: [{ role: "user", content: "hi" }] });

    assert.equal(result.answer, "Revenue is up 10%.");
    assert.equal(sent!.url, "http://llm/v1/chat/completions");
    assert.equal(sent!.auth, "Bearer k");
    assert.deepEqual(sent!.body.messages.map((m) => m.role), ["system", "user", "user"]);
    assert.ok(sent!.body.messages[0]!.content.includes("Mall One"));
  });

  it("turns upstream failures into clear errors", async () => {
    const down = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const service = new LflAskService(lfl, { provider: "openai", url: "http://llm", apiKey: null, model: "m", timeoutMs: 1000 }, down);
    await assert.rejects(service.ask({}, { question: "x" }), /answered 500/);
    await assert.rejects(new LflAskService(lfl, null).ask({}, { question: "x" }), /isn't set up/);
  });
});
