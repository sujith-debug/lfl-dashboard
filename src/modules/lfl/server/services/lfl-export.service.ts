import "server-only";

import { parseOrThrow, ValidationError } from "@foundry/api-core";
import { instrumentObject } from "@foundry/logger";
import {
  ExportInputSchema,
  LflFiltersSchema,
  SQFT_BANDS,
  STORE_REPORT_KEYS,
  type ExportInput,
  type LflFilters,
  type ReportKey,
  type StoreReportKey,
} from "../../contracts";
import { dashboardReports, storeReports, type AnyReportTable } from "../../reports";
import { toCsv, toXlsx } from "../export/report-writer";
import type { LflService } from "./lfl.service";

export type ExportFile = { filename: string; contentType: string; body: Buffer | string };

const isStoreReport = (key: string): key is StoreReportKey =>
  (STORE_REPORT_KEYS as readonly string[]).includes(key);

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Human-readable list of the filters, for the file header. */
function describeFilters(filters: LflFilters, ly: { lyFrom: string; lyTo: string }): [string, string][] {
  const lines: [string, string][] = [
    ["Period", `${filters.from} to ${filters.to}`],
    ["Compared with", `${ly.lyFrom} to ${ly.lyTo}`],
  ];
  const optional: [string, string | undefined][] = [
    ["Region", filters.region],
    ["City", filters.city],
    ["AM / CM", filters.am],
    ["Store age", filters.age],
    ["Carpet area", SQFT_BANDS.find((b) => b.key === filters.sqft)?.label],
  ];
  for (const [label, value] of optional) {
    if (value) lines.push([label, value]);
  }
  lines.push(["Stores", filters.lflOnly ? "LFL stores only" : "All stores"]);
  return lines;
}

/**
 * Builds downloads from the same report definitions the screen uses.
 * "all" gives a workbook with one sheet per report (CSV needs one report).
 */
export class LflExportService {
  constructor(private readonly lfl: LflService) {}

  async export(input: Record<string, unknown>): Promise<ExportFile> {
    const options: ExportInput = parseOrThrow(ExportInputSchema, input) as ExportInput;
    const filters = parseOrThrow(LflFiltersSchema, input) as LflFilters;

    let tables: AnyReportTable[];
    let name: string;
    let meta: { lyFrom: string; lyTo: string; notes: string[]; source: string };
    let title: string;

    if (options.store) {
      if (options.report !== "all" && !isStoreReport(options.report)) {
        throw new ValidationError("That report isn't available for a single store");
      }
      const detail = await this.lfl.getStoreDetail({ ...filters, storeId: options.store });
      const all = storeReports(detail, options.metal);
      const picked = options.report === "all" ? STORE_REPORT_KEYS.map((k) => all[k]) : [all[options.report as StoreReportKey]];
      // On screen the store is in the panel header; in a file each sheet names it.
      tables = picked.map((t) => ({ ...t, title: `${detail.store.name} · ${t.title}` }));
      name = `lfl-${slug(detail.store.name)}`;
      meta = detail.meta;
      title = `${detail.store.name} · Store LFL report`;
    } else {
      if (isStoreReport(options.report)) {
        throw new ValidationError("Pick a store for store reports");
      }
      const dashboard = await this.lfl.getDashboard(filters);
      const all = dashboardReports(dashboard, options.metal);
      tables =
        options.report === "all"
          ? (Object.keys(all) as ReportKey[])
              .filter((k) => k !== "inventory" || dashboard.inventory.connected)
              .filter((k) => k !== "tenure" || dashboard.staff.connected)
              .map((k) => all[k])
          : [all[options.report as ReportKey]];
      name = options.report === "all" ? "lfl-report" : `lfl-${options.report}`;
      meta = dashboard.meta;
      title = "Store LFL report";
    }

    const filename = `${name}_${filters.from}_${filters.to}`;
    const context = `${filters.from} to ${filters.to} vs ${meta.lyFrom} to ${meta.lyTo}`;

    if (options.format === "csv") {
      if (tables.length !== 1) {
        throw new ValidationError("CSV holds one report. Pick a report, or download Excel for everything.");
      }
      return { filename: `${filename}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(tables[0]!) };
    }

    const cover =
      tables.length > 1
        ? {
            title,
            lines: [
              ...describeFilters(filters, meta),
              ["Data", meta.source === "sample" ? "Sample data (made up)" : "BigQuery"],
              ["Generated", new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"],
              ...meta.notes.map((note): [string, string] => ["Note", note]),
            ] as [string, string][],
          }
        : undefined;
    return {
      filename: `${filename}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: await toXlsx(tables, context, cover),
    };
  }
}

export function createLflExportService(lfl: LflService): LflExportService {
  return instrumentObject(new LflExportService(lfl), {
    namePrefix: "lfl.export",
    captureResult: false,
  });
}
