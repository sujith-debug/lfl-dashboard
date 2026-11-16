import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAllowedDatasetsTables } from "@foundry/bigquery";
import { readOnlySql, referencedTables } from "./ask-sql";

const allow = parseAllowedDatasetsTables("intermediary.ebo_all_data,raw_postgres_giva_db.offline_stores");

describe("Ask the data SQL guard", () => {
  it("runs a read-only query on allowed tables, capped", () => {
    const check = readOnlySql(
      "WITH s AS (SELECT location_name, SUM(net_sales) n FROM `intermediary.ebo_all_data` WHERE type = 'sale' GROUP BY 1) SELECT * FROM s ORDER BY n DESC;",
      allow
    );
    assert.ok(check.ok);
    assert.match(check.ok ? check.sql : "", /^SELECT \* FROM \(\nWITH s AS[\s\S]*\n\) LIMIT 201$/);
  });

  it("refuses writes, several statements, schema tables and other tables", () => {
    assert.equal(readOnlySql("DELETE FROM intermediary.ebo_all_data WHERE true", allow).ok, false);
    assert.equal(readOnlySql("SELECT 1; DROP TABLE intermediary.ebo_all_data", allow).ok, false);
    assert.equal(readOnlySql("SELECT * FROM intermediary.INFORMATION_SCHEMA.COLUMNS", allow).ok, false);
    const other = readOnlySql("SELECT * FROM up_Omni.calls JOIN intermediary.ebo_all_data e ON true", allow);
    assert.deepEqual(other, { ok: false, reason: "Not an allowed table: up_Omni.calls. Use only the tables in the system prompt." });
  });

  it("doesn't mistake data or column names for keywords", () => {
    assert.ok(readOnlySql("SELECT created_at, updated_at FROM raw_postgres_giva_db.offline_stores WHERE store_type = 'delete me; drop'", allow).ok);
    assert.deepEqual(referencedTables("SELECT * FROM s JOIN `intermediary.ebo_all_data` e ON true -- FROM up_Omni.x"), ["intermediary.ebo_all_data"]);
  });
});
