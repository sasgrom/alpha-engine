import path from "node:path";
import { isForm4Placeholder, loadForm4Universe, loadReviewedPriceBars, readJsonFile, type Form4Transaction, type PriceBar } from "./lib/form4-core";
import { buildInsiderBuyClusters, type InsiderBuyCluster } from "./lib/form4-features";
import { writeJsonAtomic } from "./lib/json-file";
import { form4CacheRoot } from "./lib/cache-root";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-53.json";
const tickers = arg("--tickers") ?? "";
const universe = loadForm4Universe(path.resolve("worker", universeFile), tickers);
const root = form4CacheRoot();
const summary: { ticker: string; status: string; clusters: number; computed: number; partial: number; exclusionCounts: Record<string, number> }[] = [];

for (const company of universe) {
  if (isForm4Placeholder(company)) {
    summary.push({ ticker: company.ticker, status: "not_computable", clusters: 0, computed: 0, partial: 0, exclusionCounts: {} });
    continue;
  }
  const transactions = readJsonFile<{ transactions: Form4Transaction[] }>(path.join(root, String(company.cik), "transactions.json"), { transactions: [] }).transactions;
  const priceBars: Record<string, PriceBar[]> = { [company.ticker]: loadReviewedPriceBars(company.ticker) ?? [] };
  const { clusters, exclusionCounts } = buildInsiderBuyClusters(transactions, priceBars);
  const output = {
    schemaVersion: 1,
    signal: "insider_buy_cluster_v1",
    issuerCik: company.cik,
    ticker: company.ticker,
    generatedAt: new Date().toISOString(),
    status: clusters.length ? clusters.some((cluster) => cluster.status === "partial") ? "partial" : "computed" : "not_computable",
    clusters,
    exclusionCounts,
  };
  writeJsonAtomic(path.join(root, String(company.cik), "features.json"), output, true);
  const computed = clusters.filter((cluster: InsiderBuyCluster) => cluster.status === "computed").length;
  const partial = clusters.filter((cluster: InsiderBuyCluster) => cluster.status === "partial").length;
  summary.push({ ticker: company.ticker, status: output.status, clusters: clusters.length, computed, partial, exclusionCounts });
  console.log(`[form4-features] ${company.ticker}: ${clusters.length} clusters · ${computed} computed · ${partial} partial`);
}
writeJsonAtomic(path.join(root, "features-summary.json"), { schemaVersion: 1, signal: "insider_buy_cluster_v1", generatedAt: new Date().toISOString(), companies: summary }, true);
