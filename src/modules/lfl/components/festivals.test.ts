import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { festivalCompare, FESTIVALS } from "./festivals";
import { LflFiltersSchema } from "../contracts";

describe("festival comparisons", () => {
  it("compares Dhanteras with last year's Dhanteras, not the same date", () => {
    // 2 Nov 2026: Dhanteras 2026 (6 Nov) hasn't happened, so the last one is shown.
    const c = festivalCompare("dhanteras", "2026-11-01")!;
    assert.deepEqual([c.label, c.from, c.to, c.lyFrom, c.lyTo], ["Dhanteras 2025 vs 2024", "2025-10-18", "2025-10-18", "2024-10-29", "2024-10-29"]);
    assert.equal(c.upcoming, "2026-11-06");
    assert.equal(c.partial, false);
  });

  it("cuts both windows to the days so far while a festival week is running", () => {
    // Diwali week 2026 runs 6–11 Nov; on 8 Nov only 6–8 Nov is complete.
    const c = festivalCompare("diwali-week", "2026-11-08")!;
    assert.deepEqual([c.from, c.to, c.lyFrom, c.lyTo, c.partial], ["2026-11-06", "2026-11-08", "2025-10-18", "2025-10-20", true]);
  });

  it("uses this year's window once it has started, and fixed dates every year", () => {
    const kc = festivalCompare("karwa-chauth", "2026-11-01")!;
    assert.deepEqual([kc.label, kc.from, kc.to, kc.lyFrom, kc.lyTo], ["Karwa Chauth 2026 vs 2025", "2026-10-27", "2026-10-29", "2025-10-08", "2025-10-10"]);
    const v = festivalCompare("valentines", "2026-11-01")!;
    assert.deepEqual([v.from, v.to, v.lyFrom, v.lyTo], ["2026-02-07", "2026-02-14", "2025-02-07", "2025-02-14"]);
    const m = festivalCompare("mothers-day", "2026-11-01")!;
    assert.deepEqual([m.to, m.lyTo], ["2026-05-10", "2025-05-11"], "second Sunday of May");
  });

  it("gives windows the filters accept", () => {
    for (const f of FESTIVALS) {
      const c = festivalCompare(f.key, "2026-11-01");
      assert.ok(c, f.key);
      const parsed = LflFiltersSchema.safeParse({ from: c.from, to: c.to, lyFrom: c.lyFrom, lyTo: c.lyTo, festival: c.key });
      assert.ok(parsed.success, `${f.key}: ${parsed.success ? "" : parsed.error.message}`);
    }
    // Custom windows may differ in length, but must come before this year's dates.
    assert.equal(LflFiltersSchema.safeParse({ from: "2026-10-01", to: "2026-10-05", lyFrom: "2025-10-01", lyTo: "2025-10-02" }).success, true);
    assert.equal(LflFiltersSchema.safeParse({ from: "2026-10-01", to: "2026-10-05", lyFrom: "2026-09-28", lyTo: "2026-10-02" }).success, false, "overlaps");
    assert.equal(LflFiltersSchema.safeParse({ from: "2026-10-01", to: "2026-10-05", lyFrom: "2025-10-01" }).success, false, "half a window");
  });
});
