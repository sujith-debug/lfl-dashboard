import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { growth, sliceGrowth } from "./math";

describe("growth", () => {
  it("leaves growth blank for a slice that barely existed last year", () => {
    // 9 Kt in Oct 2026: ₹9.25 Cr this year against ₹24.5 K last year.
    assert.equal(sliceGrowth({ ty: 92_500_000, ly: 24_500 }), null);
    assert.ok(growth({ ty: 92_500_000, ly: 24_500 })! > 3000);
    assert.equal(sliceGrowth({ ty: 111_300_000, ly: 269_800_000 })!.toFixed(3), "-0.587");
    assert.equal(sliceGrowth({ ty: 100, ly: 0 }), null);
  });
});
