import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { AnalyticsService } from "./analytics.service";
import type { AnalyticsRepository } from "../repositories";
import type {
  AnalyticsDatasetRecord,
  AnalyticsPreviewRecord,
} from "../models";

class FakeAnalyticsRepository implements AnalyticsRepository {
  projectId = "demo-project";
  datasets: AnalyticsDatasetRecord[] = [
    { id: "analytics", location: "US" },
    { id: "raw", location: "US" },
  ];
  preview: AnalyticsPreviewRecord = {
    table: "analytics.events",
    jobId: "job-1",
    totalRows: 1,
    rows: [{ event: "signup" }],
  };

  getProjectId() {
    return this.projectId;
  }

  async listDatasets() {
    return this.datasets;
  }

  async previewTable(table: string, limit: number) {
    return {
      ...this.preview,
      table,
      rows: this.preview.rows.slice(0, limit),
      totalRows: Math.min(this.preview.totalRows, limit),
    };
  }
}

describe("AnalyticsService", () => {
  const previousProject = process.env.BIGQUERY_PROJECT_ID;
  const previousTable = process.env.BIGQUERY_SAMPLE_TABLE;

  beforeEach(() => {
    process.env.BIGQUERY_PROJECT_ID = "demo-project";
    process.env.BIGQUERY_SAMPLE_TABLE = "analytics.events";
  });

  afterEach(() => {
    if (previousProject === undefined) {
      delete process.env.BIGQUERY_PROJECT_ID;
    } else {
      process.env.BIGQUERY_PROJECT_ID = previousProject;
    }
    if (previousTable === undefined) {
      delete process.env.BIGQUERY_SAMPLE_TABLE;
    } else {
      process.env.BIGQUERY_SAMPLE_TABLE = previousTable;
    }
  });

  it("returns an overview of datasets", async () => {
    const service = new AnalyticsService(new FakeAnalyticsRepository());
    const overview = await service.getOverview();

    assert.equal(overview.configured, true);
    assert.equal(overview.projectId, "demo-project");
    assert.equal(overview.datasets.length, 2);
    assert.equal(overview.sampleTable, "analytics.events");
    assert.ok(Array.isArray(overview.allowedTables));
  });

  it("previews the configured sample table", async () => {
    const service = new AnalyticsService(new FakeAnalyticsRepository());
    const preview = await service.previewSample({ limit: 5 });

    assert.equal(preview.table, "analytics.events");
    assert.equal(preview.rows[0]?.event, "signup");
    assert.equal(preview.jobId, "job-1");
  });
});
