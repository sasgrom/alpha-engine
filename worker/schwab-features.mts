/** Materialize small provider-specific Schwab feature snapshots without LLM calls. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildSchwabFeatureReport, type SchwabPriceCandle } from "./lib/schwab-features";
import type { SchwabMarketSnapshot } from "./lib/schwab-normalize";
import { schwabTokenDirectory } from "./lib/schwab";
import { writeSchwabJsonOutputs } from "./lib/schwab-output";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const root = path.resolve(arg("--root") ?? schwabTokenDirectory());
const snapshotPath = path.resolve("public/reports/schwab-market-data.json");
if (!existsSync(snapshotPath)) throw new Error("Build schwab-market-data.json before materializing features");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as SchwabMarketSnapshot;
const manifestPath = path.join(root, "manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")) as { tickers: { ticker: string }[] }
  : { tickers: snapshot.files.map((file) => ({ ticker: file.ticker })) };
const prices: Record<string, SchwabPriceCandle[]> = {};
for (const ticker of new Set(snapshot.options.map((row) => row.underlying))) {
  const file = path.join(root, "pricehistory", `${ticker}.json`);
  if (!existsSync(file)) continue;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { candles?: SchwabPriceCandle[] };
    if (Array.isArray(doc.candles)) prices[ticker] = doc.candles;
  } catch { /* invalid or missing price history leaves RV20 explicitly null */ }
}
const report = buildSchwabFeatureReport({ snapshot, manifest, prices, generatedAt: new Date().toISOString() });
writeSchwabJsonOutputs("schwab-features.json", report);
console.log(`[schwab-features] ${report.coverage.tickers} tickers · ${report.coverage.contracts} contracts · RV20 ${report.coverage.rv20Available}/${report.coverage.tickers} · source ${report.sourceSnapshotSha256.slice(0, 12)}`);
