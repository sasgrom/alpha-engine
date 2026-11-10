import path from "node:path";
import { isForm4Placeholder, loadForm4Universe, readJsonFile } from "./lib/form4-core";
import { benchmarkForm4Cluster, FORM4_BENCHMARK_MAX_ENTRY_GAP_DAYS, loadForm4BenchmarkPriceStore, summarizeForm4Benchmark } from "./lib/form4-benchmark";
import type { InsiderBuyCluster } from "./lib/form4-features";
import { writeJsonAtomic } from "./lib/json-file";
import { form4CacheRoot, form4QaRunsRoot } from "./lib/cache-root";
import { getDb } from "../api/queries/connection";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-50.json";
const tickers = arg("--tickers") ?? "";
const dryRun = process.argv.includes("--dry-run");
const universe = loadForm4Universe(path.resolve("worker", universeFile), tickers).filter((company) => !isForm4Placeholder(company));
const asOf = arg("--as-of") ?? new Date().toISOString();
const maxEntryGapDays = Number(arg("--max-gap-days") ?? FORM4_BENCHMARK_MAX_ENTRY_GAP_DAYS);
if (!Number.isInteger(maxEntryGapDays) || maxEntryGapDays < 1 || maxEntryGapDays > 365) throw new Error("--max-gap-days must be between 1 and 365");
const store = await loadForm4BenchmarkPriceStore(universe, asOf, maxEntryGapDays);
const root = form4CacheRoot();
const clusters = universe.flatMap((company) => readJsonFile<{ clusters?: InsiderBuyCluster[] }>(path.join(root, String(company.cik), "features.json"), {}).clusters ?? []);
const results = clusters.map((cluster) => ({ clusterId: cluster.clusterId, ticker: cluster.ticker, availableAt: cluster.availableAt, ...benchmarkForm4Cluster(cluster, store) }));
const summary = summarizeForm4Benchmark(results);
const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  dryRun,
  signal: "insider_buy_cluster_v1",
  methodology: "canonical_dailyPrice_v1",
  priceEvidence: { source: "local_mysql_dailyPrice", asOf, maxEntryGapDays },
  ...summary,
  results,
};
writeJsonAtomic(path.join(form4QaRunsRoot(), "benchmark-summary.json"), output, true);
console.log(JSON.stringify({ signal: output.signal, dryRun, status: output.status, methodology: output.methodology, priceEvidence: output.priceEvidence, notProductionAlpha: output.notProductionAlpha, horizons: output.horizons, coverageByYear: output.coverageByYear }, null, 2));
await getDb().$client.end();
