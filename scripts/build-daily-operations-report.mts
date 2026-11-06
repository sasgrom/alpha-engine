/** Build a credential-free daily health report from actual scheduler and snapshot evidence. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDailyOperationsReport, dailyOperationsMarkdown, type SchwabDailyPriceArtifact } from "../worker/lib/daily-operations-report";
import { loadOperationConfig, loadOperationsState, OPERATIONS_CONFIG_FILE } from "../worker/lib/operations-scheduler";
import { sha256Text, type SchwabMarketSnapshot } from "../worker/lib/schwab-normalize";
import type { SchwabFeatureReport } from "../worker/lib/schwab-features";
import type { SchwabContextReport } from "../worker/lib/schwab-context";
import type { MacroOperationsArtifacts } from "../worker/lib/macro-operations-health";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { summarizeFactsManifest } from "../worker/lib/facts-incremental";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const now = new Date().toISOString();
const date = arg("--date") ?? now.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");

function readJson<T>(file: string, valid: (value: any) => boolean): T | null {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return valid(value) ? value as T : null;
  } catch { return null; }
}
const snapshot = readJson<SchwabMarketSnapshot>(path.resolve("public/reports/schwab-market-data.json"), (value) => value?.schemaVersion === 1 && Array.isArray(value.files) && !!value.coverage && !!value.qa);
const features = readJson<SchwabFeatureReport>(path.resolve("public/reports/schwab-features.json"), (value) => value?.schemaVersion === 1 && typeof value.sourceSnapshotSha256 === "string" && !!value.coverage);
const dailyPrices = readJson<SchwabDailyPriceArtifact>(path.resolve("worker/.runs/local-generated/daily-prices-50.json"), (value) => value?.schemaVersion === 1 && Number.isInteger(value.universeSize) && Array.isArray(value.companies));
const context = readJson<SchwabContextReport>(path.resolve("public/reports/schwab-context.json"), (value) => value?.schemaVersion === 1 && !!value.coverage);
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const macro: MacroOperationsArtifacts = {
  fred: readJson<MacroOperationsArtifacts["fred"]>(path.join(macroRoot, "manifest-fred.json"), (value) => value?.schemaVersion === 1 && Array.isArray(value.entries)),
  events: readJson<MacroOperationsArtifacts["events"]>(path.join(macroRoot, "manifest-events.json"), (value) => value?.schemaVersion === 1 && Array.isArray(value.pages)),
  qa: readJson<MacroOperationsArtifacts["qa"]>(path.resolve("worker/.runs/macro-manifest-qa.json"), (value) => value?.schemaVersion === 1 && typeof value.status === "string"),
  scenarios: readJson<MacroOperationsArtifacts["scenarios"]>(path.resolve("public/reports/macro-scenarios.json"), (value) => value?.schemaVersion === 1),
  calibration: readJson<MacroOperationsArtifacts["calibration"]>(path.resolve("public/reports/shock-calibration.json"), (value) => value?.schemaVersion === 1 && Array.isArray(value.calibrations)),
  eventStudy: readJson<MacroOperationsArtifacts["eventStudy"]>(path.resolve("public/reports/macro-event-study.json"), (value) => value?.schemaVersion === 1 && !!value.events),
  atlas: readJson<MacroOperationsArtifacts["atlas"]>(path.resolve("public/reports/macro-transmission-atlas.json"), (value) => value?.schemaVersion === 1 && !!value.coverage),
};
const facts = { sp500: summarizeFactsManifest(path.resolve("worker/cache/companyfacts"), loadEdgarUniverse("edgar-universe.json")) };
const report = buildDailyOperationsReport({
  now,
  date,
  state: loadOperationsState(),
  config: loadOperationConfig(),
  configurationSource: existsSync(OPERATIONS_CONFIG_FILE) ? "file" : "registry_defaults",
  snapshot,
  snapshotSha256: snapshot ? sha256Text(JSON.stringify(snapshot)) : null,
  features,
  dailyPrices,
  context,
  macro,
  facts,
  dataMode: "live",
});
const markdown = dailyOperationsMarkdown(report);
const jsonPath = path.resolve("public/reports/daily-operations.json");
const markdownPath = path.resolve("public/reports/daily-operations.md");
writeJsonAtomic(jsonPath, report, true);
writeFileSync(markdownPath, markdown, "utf8");
const distReports = path.resolve("dist/public/reports");
if (existsSync(path.dirname(distReports))) {
  mkdirSync(distReports, { recursive: true });
  writeJsonAtomic(path.join(distReports, "daily-operations.json"), report, true);
  writeFileSync(path.join(distReports, "daily-operations.md"), markdown, "utf8");
}
console.log(`[daily-operations] ${report.status.toUpperCase()} · scheduler ${report.scheduler.status} · Schwab today ${report.schwab.tickersCapturedToday}/${report.schwab.tickersExpected} · checks ${report.summary.checksOk} ok/${report.summary.checksWarning} warning/${report.summary.checksError} error · ${jsonPath}`);
