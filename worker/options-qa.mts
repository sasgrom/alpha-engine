/** Offline option-data QA. No provider calls, DB writes or feature changes.
 * Run: npx tsx worker/options-qa.mts */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OptionChainSnapshot } from "./lib/options";
import { buildOptionQaReport, type OptionQaReport } from "./lib/options-qa";
import { writeJsonAtomic } from "./lib/json-file";

const ROOT = path.resolve(import.meta.dirname, "cache", "options-normalized");
const MANIFEST = path.resolve(import.meta.dirname, "cache", "options", "manifest.json");
const OUT = path.resolve(import.meta.dirname, "cache", "options-qa");
function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? jsonFiles(file) : entry.isFile() && file.endsWith(".json") ? [file] : [];
  });
}
const files = jsonFiles(ROOT);
if (!files.length) throw new Error(`No normalized option snapshots under ${ROOT}`);
const snapshots = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as OptionChainSnapshot);
const report = buildOptionQaReport(snapshots);
const identity = (x: { provider: string; underlying: string; tradeDate: string; snapshotId?: string | null }) =>
  `${x.provider}|${x.underlying}|${x.tradeDate}|${x.snapshotId ?? "none"}`;
const fileKeys = new Set(snapshots.map(identity));
type ManifestRow = { provider: string; underlying: string; tradeDate: string; snapshotId?: string | null };
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestRow[] : [];
const manifestKeys = new Set(manifest.map(identity));
const inventory = {
  manifestRows: manifest.length,
  normalizedFiles: files.length,
  uniqueNormalizedKeys: fileKeys.size,
  missingNormalizedArtifacts: [...manifestKeys].filter((key) => !fileKeys.has(key)).sort(),
  untrackedNormalizedFiles: [...fileKeys].filter((key) => !manifestKeys.has(key)).sort(),
};
const output = { ...report, inventory };

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const num = (x: number | null, digits = 2) => x === null ? "n/a" : x.toFixed(digits);
function qualityRow(label: string, s: OptionQaReport["summary"]): string {
  return `| ${label} | ${s.snapshots} | ${s.underlyings} | ${s.contracts} | ${pct(s.coverage.iv)} | ${pct(s.coverage.openInterest)} | ${pct(s.coverage.allGreeks)} | ${s.quotes.zeroBid.count} (${pct(s.quotes.zeroBid.rate)}) | ${s.quotes.zeroAsk.count} | ${s.quotes.crossed.count} | ${s.quotes.locked.count} |`;
}
const lines = [
  "# Offline option data QA", "", `Generated: ${report.generatedAt}`, "",
  "This is a data-quality report, not evidence of predictive value.", "",
  "## Inventory", "",
  `- Manifest rows: ${inventory.manifestRows}`,
  `- Normalized snapshots: ${inventory.normalizedFiles}`,
  `- Missing normalized artifacts: ${inventory.missingNormalizedArtifacts.length}`,
  `- Untracked normalized files: ${inventory.untrackedNormalizedFiles.length}`, "",
  "## Contract quality", "",
  "| Provider | Snapshots | Underlyings | Contracts | IV | OI | All Greeks | Zero bid | Zero ask | Crossed | Locked |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  qualityRow("All", report.summary),
  ...report.providers.map((row) => qualityRow(row.provider, row)), "",
  "## Integrity and timestamps", "",
  `- Duplicate rows: ${report.summary.duplicates}; invalid rows: ${report.summary.invalidRows}; snapshots with provider warnings: ${report.summary.warningSnapshots}.`,
  `- Expired contracts: ${report.summary.integrity.expired}; contract/snapshot date mismatches: ${report.summary.integrity.tradeDateMismatch}.`,
  `- Invalid signed deltas: ${report.summary.integrity.invalidDelta}; negative IV: ${report.summary.integrity.negativeIv}; IV above 500%: ${report.summary.integrity.ivAbove500Percent}.`,
  `- Zero OI: ${report.summary.integrity.zeroOpenInterest}; zero volume: ${report.summary.integrity.zeroVolume}.`,
  `- Ingestion lag median/p95: ${num(report.summary.timing.medianLagMinutes)} / ${num(report.summary.timing.p95LagMinutes)} minutes; negative lags: ${report.summary.timing.negativeLag}.`,
  `- Unparseable availability timestamps: ${report.summary.timing.unavailableLag}; missing timezone qualifiers: ${report.summary.timing.missingTimezone}.`,
  "- OI timestamps are not represented by the current normalized schema; OI freshness is therefore unproven.", "",
  "## History by provider and underlying", "",
  "| Provider | Underlying | Snapshots | Trade dates | First | Last |",
  "|---|---|---:|---:|---|---|",
  ...report.history.map((h) => `| ${h.provider} | ${h.underlying} | ${h.snapshots} | ${h.tradeDates} | ${h.firstTradeDate} | ${h.lastTradeDate} |`), "",
  "## Cross-provider comparison", "",
];
if (!report.crossProvider.length) {
  lines.push("No same-underlying, same-trade-date provider pairs exist. Numeric IV/Greeks comparison is not yet possible.");
} else {
  lines.push("| Left | Right | Matched (left/right) | IV MAE | IV median | Near-ATM IV MAE | Delta MAE | Time delta (min) |", "|---|---|---:|---:|---:|---:|---:|---:|");
  for (const c of report.crossProvider) lines.push(`| ${c.left} | ${c.right} | ${c.matchedContracts} (${c.leftContracts}/${c.rightContracts}) | ${num(c.iv.mae, 5)} | ${num(c.iv.medianAbs, 5)} | ${num(c.nearAtmIv.mae, 5)} | ${num(c.delta.mae, 5)} | ${num(c.availabilityDeltaMinutes, 1)} |`);
}
if (inventory.missingNormalizedArtifacts.length) {
  lines.push("", "## Missing normalized artifacts", "", ...inventory.missingNormalizedArtifacts.map((key) => `- ${key}`));
}
mkdirSync(OUT, { recursive: true });
writeJsonAtomic(path.join(OUT, "options-qa.json"), output, true);
const mdTmp = path.join(OUT, "options-qa.md.tmp");
writeFileSync(mdTmp, `${lines.join("\n")}\n`);
renameSync(mdTmp, path.join(OUT, "options-qa.md"));
console.log(JSON.stringify({ output: path.join(OUT, "options-qa.json"), inventory, summary: report.summary, crossProviderPairs: report.crossProvider.length }, null, 2));
process.exit(0);
