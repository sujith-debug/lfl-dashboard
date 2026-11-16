import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoreRowDto } from "../contracts";
import { storeState } from "./dashboard-reports";

const row = (extra: Partial<StoreRowDto>) => ({ status: "Live", lastSaleOn: "2026-10-30", looksShut: false, closedButSelling: false, ...extra }) as StoreRowDto;

describe("store status line", () => {
  it("says when a store is closed and when it last sold", () => {
    assert.equal(storeState(row({ status: "Closed", lastSaleOn: "2026-04-26" })), " · Closed · last sale 26 Apr 2026");
  });
  it("flags a store marked Live that hasn't sold for a month", () => {
    assert.equal(storeState(row({ looksShut: true, lastSaleOn: "2026-07-31" })), " · no sale since 31 Jul 2026 (marked Live)");
  });
  it("flags a store marked Closed that is still billing", () => {
    assert.equal(storeState(row({ status: "Closed", closedButSelling: true, lastSaleOn: "2026-11-02" })), " · marked Closed but still selling (last sale 2 Nov 2026)");
  });
  it("adds nothing for a trading store", () => {
    assert.equal(storeState(row({})), "");
  });
});
