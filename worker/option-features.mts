/**
 * Offline option_features builder. Reads normalized Cboe snapshots and writes
 * DTE-bucket features plus a manifest; no provider calls and no invented history.
 * Run: npx tsx worker/option-features.mts [--only NVDA] [--all]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildOptionFeatures } from "./lib/option-features";
import { writeJsonAtomic } from "./lib/json-file";
import type { OptionChainSnapshot } from "./lib/options";

const ROOT = path.resolve(import.meta.dirname, "cache", "options-normalized", "cboe");
const OUT = path.resolve(import.meta.dirname, "cache", "option-features");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const all = process.argv.includes("--all");
function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? jsonFiles(p) : entry.isFile() && p.endsWith(".json") ? [p] : [];
  });
}
const files = jsonFiles(ROOT).filter((f) => !only || path.basename(f) === `${only}.json`);
const latest = new Map<string, string>();
for (const file of files) {
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as OptionChainSnapshot;
  const key = snapshot.underlying;
  if (all) {
    // keep every snapshot for historical research
  } else if (!latest.has(key) || snapshot.availableAt > JSON.parse(readFileSync(latest.get(key)!, "utf8")).availableAt) {
    latest.set(key, file);
  }
}
const selected = all ? files : [...latest.values()];
if (selected.length === 0) { console.error("[option-features] no normalized Cboe snapshots found"); process.exit(1); }
const manifest: any[] = [];
for (const file of selected) {
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as OptionChainSnapshot;
  const features = buildOptionFeatures(snapshot);
  const outFile = path.join(OUT, snapshot.tradeDate, snapshot.snapshotId ?? "unknown", `${snapshot.underlying}.json`);
  writeJsonAtomic(outFile, features);
  manifest.push({
    provider: features.provider, underlying: features.underlying, tradeDate: features.tradeDate,
    availableAt: features.availableAt, snapshotId: features.snapshotId ?? null,
    spot: features.spot, buckets: features.buckets.map((b) => b.bucket), quality: features.quality,
    warnings: features.warnings,
  });
  console.log(`[option-features] ${features.underlying}: ${features.buckets.length} DTE buckets · ${features.quality.contracts} contracts · ${features.warnings.length} warnings`);
}
writeJsonAtomic(path.join(OUT, "manifest.json"), manifest);
console.log(`[option-features] wrote ${manifest.length} feature sets to ${OUT}`);
process.exit(0);
