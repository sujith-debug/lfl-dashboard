/**
 * Load a feed file into the app database, the same way the BigQuery pull does.
 *   npm run lfl:import -- <daily|stores|inventory|carpet> <file.csv|file.xlsx>
 *   npm run lfl:sync -- [from YYYY-MM-DD] [to YYYY-MM-DD]   (pulls from BigQuery)
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { DATASETS, type Dataset } from "@/modules/lfl/server/ingest";
import { getLflImportService, getLflSyncService } from "@/modules/lfl/server/container";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "sync") {
    // lfl:sync -- [from] [to] [dataset,dataset]  e.g. 2025-04-01 2026-10-18 segments
    const [from, to, only] = args;
    const datasets = only ? (only.split(",") as Dataset[]) : undefined;
    const report = await getLflSyncService().sync({ from, to, datasets });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const dataset = command as Dataset;
  const file = args[0];
  if (!DATASETS.includes(dataset) || !file) {
    console.error(`Usage: lfl-import <${DATASETS.join("|")}> <file>  |  lfl-import sync [from] [to]`);
    process.exit(1);
  }
  const result = await getLflImportService().importFile(dataset, readFileSync(file), basename(file), "file");
  console.log(`${dataset}: ${result.rows} rows imported, ${result.skipped} skipped`);
  for (const note of result.notes) console.log(`  · ${note}`);
  if (result.unmatched.length) {
    console.log(`  · ${result.unmatched.length} store names didn't match the store list:`);
    console.log("    " + result.unmatched.slice(0, 40).join(", ") + (result.unmatched.length > 40 ? ", …" : ""));
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
