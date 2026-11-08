import path from "node:path";
import { isForm4Placeholder, loadForm4Universe, loadReviewedPriceBars, readJsonFile } from "./lib/form4-core";
import { benchmarkForm4Cluster, summarizeForm4Benchmark } from "./lib/form4-benchmark";
import type { InsiderBuyCluster } from "./lib/form4-features";
import { writeJsonAtomic } from "./lib/json-file";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-53.json";
const tickers = arg("--tickers") ?? "";
const dryRun = process.argv.includes("--dry-run");
const universe = loadForm4Universe(path.resolve("worker", universeFile), tickers);
const root = path.resolve("worker/cache/edgar-form4");
const barsByTicker = Object.fromEntries(universe.filter((company) => !isForm4Placeholder(company)).map((company) => [company.ticker, loadReviewedPriceBars(company.ticker) ?? []]));
const clusters = universe.flatMap((company) => readJsonFile<{ clusters?: InsiderBuyCluster[] }>(path.join(root, String(company.cik), "features.json"), {}).clusters ?? []);
const results = clusters.map((cluster) => ({ clusterId: cluster.clusterId, ticker: cluster.ticker, availableAt: cluster.availableAt, ...benchmarkForm4Cluster(cluster, barsByTicker) }));
const summary = summarizeForm4Benchmark(results);
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  dryRun,
  signal: "insider_buy_cluster_v1",
  ...summary,
  results,
};
writeJsonAtomic(path.resolve("worker/.runs/form4-qa/benchmark-summary.json"), output, true);
console.log(JSON.stringify({ signal: output.signal, dryRun, status: output.status, notProductionAlpha: output.notProductionAlpha, horizons: output.horizons }, null, 2));
