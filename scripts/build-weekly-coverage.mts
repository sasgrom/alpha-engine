import "dotenv/config";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface InventoryTable {
  present: boolean;
  rows?: number;
  contentSha256?: string;
  maxDate?: string | null;
}
interface Inventory {
  generatedAt: string;
  tables: Record<string, InventoryTable>;
}

export function buildWeeklyCoverage(baseline: Inventory | null, current: Inventory) {
  const tables = Object.keys(current.tables).sort().map((table) => {
    const before = baseline?.tables[table];
    const after = current.tables[table];
    return {
      table,
      present: after.present,
      baselinePresent: before?.present ?? false,
      rows: after.rows ?? null,
      baselineRows: before?.rows ?? null,
      deltaRows: after.rows !== undefined && before?.rows !== undefined ? after.rows - before.rows : null,
      contentSha256: after.contentSha256 ?? null,
      baselineContentSha256: before?.contentSha256 ?? null,
      hashChanged: after.contentSha256 !== before?.contentSha256,
      maxDate: after.maxDate ?? null,
      baselineMaxDate: before?.maxDate ?? null,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: current.generatedAt,
    baselineGeneratedAt: baseline?.generatedAt ?? null,
    status: baseline ? "ready" : "baseline_missing",
    summary: {
      tables: tables.length,
      tablesPresent: tables.filter((row) => row.present).length,
      tablesMissing: tables.filter((row) => !row.present).length,
      tablesWithRowIncrease: tables.filter((row) => (row.deltaRows ?? 0) > 0).length,
      tablesWithRowDecrease: tables.filter((row) => (row.deltaRows ?? 0) < 0).length,
      tablesWithHashDrift: tables.filter((row) => row.hashChanged).length,
      rows: tables.reduce((sum, row) => sum + (row.rows ?? 0), 0),
      baselineRows: tables.reduce((sum, row) => sum + (row.baselineRows ?? 0), 0),
      deltaRows: tables.reduce((sum, row) => sum + (row.deltaRows ?? 0), 0),
    },
    tables,
  };
}

function readInventory(file: string): Inventory {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const currentFile = path.resolve(option("--current") ?? "research/reviewed-sync/2026-11-10/inventory-local.json");
  const baselineFile = option("--baseline");
  const current = readInventory(currentFile);
  let baseline: Inventory | null = baselineFile ? readInventory(baselineFile) : null;
  if (!baseline) {
    const candidates = readdirSync("worker/.runs").filter((file) => /^inventory-local-\d+\.json$/.test(file)).sort().reverse();
    const previous = candidates.find((file) => path.resolve("worker/.runs", file) !== currentFile && readInventory(path.join("worker/.runs", file)).generatedAt < current.generatedAt);
    if (previous) baseline = readInventory(path.join("worker/.runs", previous));
  }
  const report = buildWeeklyCoverage(baseline, current);
  const outJson = path.resolve("public/reports/weekly-coverage.json");
  const outMarkdown = path.resolve("public/reports/weekly-coverage.md");
  writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Weekly coverage and drift report",
    "",
    `Generated: ${report.generatedAt} · Baseline: ${report.baselineGeneratedAt ?? "missing"} · Status: ${report.status}`,
    "",
    `Tables: ${report.summary.tables} · Present: ${report.summary.tablesPresent} · Missing: ${report.summary.tablesMissing} · Hash drift: ${report.summary.tablesWithHashDrift} · Rows: ${report.summary.rows} (${report.summary.deltaRows >= 0 ? "+" : ""}${report.summary.deltaRows})`,
    "",
    "| Table | Rows | Baseline rows | Delta | Hash changed | Max date |",
    "|---|---:|---:|---:|---|---|",
    ...report.tables.map((row) => `| ${row.table} | ${row.rows ?? "—"} | ${row.baselineRows ?? "—"} | ${row.deltaRows ?? "—"} | ${row.hashChanged ? "yes" : "no"} | ${row.maxDate ?? "—"} |`),
    "",
  ];
  writeFileSync(outMarkdown, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ outJson, outMarkdown, ...report.summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("build-weekly-coverage.mts")) await main();
