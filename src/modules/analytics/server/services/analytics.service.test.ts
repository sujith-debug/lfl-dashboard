import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { AnalyticsService } from "./analytics.service";
import type { AnalyticsRepository } from "../repositories";
import type { AnalyticsQueryRecord } from "../models";

class FakeAnalyticsRepository implements AnalyticsRepository {
  async queryTable(table: string, limit: number): Promise<AnalyticsQueryRecord> {
    return {
      table,
      jobId: "job-1",
      totalRows: 1,
      rows: [{ event: "signup" }].slice(0, limit),
    };
  }
}

describe("AnalyticsService", () => {
  const previousAllow = process.env.BQ_ALLOWED_DATASETS_TABLES;

  beforeEach(() => {
    delete process.env.BQ_ALLOWED_DATASETS_TABLES;
  });

  afterEach(() => {
    if (previousAllow === undefined) {
      delete process.env.BQ_ALLOWED_DATASETS_TABLES;
    } else {
      process.env.BQ_ALLOWED_DATASETS_TABLES = previousAllow;
    }
  });

  it("runs a query for the requested table and returns rows", async () => {
    const service = new AnalyticsService(new FakeAnalyticsRepository());
    const result = await service.runQuery({
      table: "analytics.events",
      limit: 5,
    });

    assert.equal(result.table, "analytics.events");
    assert.equal(result.rows[0]?.event, "signup");
    assert.equal(result.jobId, "job-1");
  });
});
