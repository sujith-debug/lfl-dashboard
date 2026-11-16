import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lflDailySql, lflInventorySql, lflSegmentsSql, lflStaffSalesSql, lflStoresSql, type FeedTables } from "./feed-sql";
import { shopifyLinesSql, storeBillsSql } from "./shopify-lines";

describe("BigQuery feed SQL", () => {
  it("only accepts ISO dates, so nothing else reaches the SQL text", () => {
    assert.throws(() => lflDailySql("2026-09-01'; DROP", "2026-09-30"));
    assert.throws(() => lflInventorySql(["yesterday"]));
  });

  it("reads EBO lines straight from BigQuery and compares with 365 days earlier", () => {
    const sql = lflDailySql("2026-09-01", "2026-09-30");
    assert.ok(sql.includes("`intermediary.ebo_all_data`"));
    assert.ok(!sql.includes("{{"), "plain BigQuery SQL, no template tags");
    assert.ok(sql.includes("DATE_SUB(DATE '2026-09-01', INTERVAL 365 DAY)"));
    assert.ok(sql.includes("/ 1.03"), "net sales are ex-GST as in #8734");
    for (const column of ["TY_S_NOB", "LY_S_NOB", "TY_G_qty", "LY_S_qty", "TY_G_line_sales", "LY_S_line_sales", "TY_G_MTO_sales", "LY_G_MTO_NOB", "TY_G_MTO_qty", "LY_G_MTO_line_sales"]) {
      assert.ok(sql.includes(` AS ${column}`), `daily feed carries ${column}`);
    }
  });

  it("uses the same EBO lines for karat / category and staff sales", () => {
    for (const sql of [lflSegmentsSql("2026-09-01", "2026-09-30"), lflStaffSalesSql("2026-09-01", "2026-09-30")]) {
      assert.ok(sql.includes("sku_category AS category"));
      assert.ok(!sql.includes("{{"));
    }
  });
});

describe("Feed SQL without the EBO table", () => {
  const shopify: FeedTables = { sales: "shopify", mto: "tag", productTags: false };
  const all = [
    lflDailySql("2026-10-01", "2026-10-31", shopify),
    lflSegmentsSql("2026-10-01", "2026-10-31", shopify),
    lflStoresSql(shopify),
    lflInventorySql(["2026-10-31"], shopify),
  ];

  it("reads none of the tables the service account can't, and the same output columns", () => {
    for (const sql of all) {
      for (const table of ["ebo_all_data", "mto_orders_new", "shopify_products", "shopify_product_variants"]) {
        assert.ok(!sql.includes(table), `doesn't read ${table}`);
      }
    }
    const [daily] = all;
    for (const column of ["TY_Net_sales_after_ERDP", "LY_G_NOB", "TY_G_MTO_sales", "TY_FF"]) assert.ok(daily!.includes(` AS ${column}`));
  });

  it("prunes every read of Shopify orders that touches line items or refunds to the window's sync dates", () => {
    // One unpruned read makes BigQuery scan the whole table (~18 GB) for every column the query uses.
    for (const sql of all) {
      const reads = sql.split("`airbyte.shopify_orders`").slice(1);
      for (const after of reads) {
        const where = after.slice(0, after.search(/\)\s*,|\n\s*\),|\n\s*\)$/) + 1 || undefined);
        assert.ok(/_airbyte_extracted_at >= TIMESTAMP/.test(where), `pruned: ${where.slice(0, 120)}`);
      }
    }
    // The daily window reaches back to last year's window, a year before it.
    assert.ok(all[0]!.includes("DATE '2025-10-01'"));
  });

  it("maps karat from the sold line when there are no product tags, and category from the SKU prefix", () => {
    assert.ok(all[1]!.includes("COALESCE(t.carat, REGEXP_EXTRACT(l.purity"));
    assert.ok(all[1]!.includes("STRUCT('GDLR' AS p, 'Gold Rings' AS c)"));
  });

  it("finds a swap's original bill in givametabse.orders up to when it stopped, Shopify after", () => {
    const bills = storeBillsSql("2026-11-04");
    assert.ok(bills.includes("FROM givametabse.orders"));
    assert.ok(bills.includes("DATE '2026-10-28'"), "the Shopify part reaches back to where givametabse.orders stops");
    assert.throws(() => shopifyLinesSql([["2026-10-01' OR 1=1", "2026-10-31"]]));
  });
});
