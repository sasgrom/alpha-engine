import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies, prices, seriesPoints } from "@db/schema";
import { expandingLogOls, expandingMetrics, type LogMarketRevenuePoint } from "../api/services/market-cap-ols";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const db = getDb();
const asOf = new Date().toISOString().slice(0, 10);
const timestamp = (value: unknown): number => value instanceof Date ? value.getTime() : Date.parse(String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`);

interface ConceptPoint { periodEnd: string; val: number | null; sourceFiled: string | null }
async function pitConcept(cik: number, concept: string, kind: "flow" | "stock"): Promise<ConceptPoint[]> {
  const rows = await db.select({ periodEnd: seriesPoints.periodEnd, val: seriesPoints.val, sourceFiled: seriesPoints.sourceFiled, vintage: seriesPoints.vintage })
    .from(seriesPoints)
    .where(and(eq(seriesPoints.cik, cik), eq(seriesPoints.concept, concept), eq(seriesPoints.kind, kind), sql`${seriesPoints.sourceFiled} <= ${asOf}`))
    .orderBy(asc(seriesPoints.periodEnd), asc(seriesPoints.sourceFiled));
  const byPeriod = new Map<string, { latest?: ConceptPoint; first?: ConceptPoint }>();
  for (const row of rows) {
    const entry = byPeriod.get(row.periodEnd) ?? {};
    if (row.vintage === "latest") entry.latest = row;
    else entry.first = row;
    byPeriod.set(row.periodEnd, entry);
  }
  return [...byPeriod.values()].map((entry) => ({ latest: entry.latest ?? null, first: entry.first ?? null })).filter((entry) => entry.latest?.sourceFiled || entry.first?.sourceFiled);
}

function availableAtAnchor(entry: { latest: ConceptPoint | null; first: ConceptPoint | null } | undefined, anchor: string): ConceptPoint | null {
  if (!entry) return null;
  if (entry.latest?.sourceFiled && entry.latest.sourceFiled <= anchor) return entry.latest;
  if (entry.first?.sourceFiled && entry.first.sourceFiled <= anchor) return entry.first;
  return null;
}

function latestAvailableAtOrBefore(entries: { latest: ConceptPoint | null; first: ConceptPoint | null }[], anchor: string): ConceptPoint | null {
  const periods = [...new Set(entries.map((entry) => entry.latest?.periodEnd ?? entry.first?.periodEnd).filter((period): period is string => Boolean(period && period <= anchor)))].sort().reverse();
  for (const period of periods) {
    const entry = entries.find((candidate) => (candidate.latest?.periodEnd ?? candidate.first?.periodEnd) === period);
    const selected = availableAtAnchor(entry, anchor);
    if (selected) return selected;
  }
  return null;
}

function closeAt(rows: { id: number; date: string; close: number | null; adjClose: number | null; source: string; fetchedAt: Date | string | null }[], anchor: string) {
  const candidates = rows.filter((row) => row.date <= anchor && row.fetchedAt && timestamp(row.fetchedAt) <= Date.parse(`${asOf}T23:59:59.999Z`))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.source === "schwab") - Number(a.source === "schwab") || timestamp(b.fetchedAt) - timestamp(a.fetchedAt) || b.id - a.id);
  const selected = candidates[0];
  return selected ? selected.adjClose ?? selected.close : null;
}

const registry = await db.select({ cik: companies.cik, sector: companies.sector }).from(companies).where(inArray(companies.cik, universe.map((company) => company.cik)));
const sectorByCik = new Map(registry.map((row) => [row.cik, row.sector]));
const companyResults = [];
const allPoints: LogMarketRevenuePoint[] = [];

for (const [index, company] of universe.entries()) {
  const [revenueRows, shareRows, weightedRows, priceRows] = await Promise.all([
    pitConcept(company.cik, "RevenueFromContractWithCustomerExcludingAssessedTax", "flow"),
    pitConcept(company.cik, "CommonStockSharesOutstanding", "stock"),
    pitConcept(company.cik, "WeightedAverageNumberOfDilutedSharesOutstanding", "flow"),
    db.select({ id: prices.id, date: prices.date, close: prices.close, adjClose: prices.adjClose, source: prices.source, fetchedAt: prices.fetchedAt }).from(prices).where(eq(prices.cik, company.cik)).orderBy(asc(prices.date)),
  ]);
  const revenueByPeriod = new Map(revenueRows.map((row) => [row.latest?.periodEnd ?? row.first?.periodEnd, row]));
  const shareByPeriod = new Map(shareRows.map((row) => [row.latest?.periodEnd ?? row.first?.periodEnd, row]));
  const weightedByPeriod = new Map(weightedRows.map((row) => [row.latest?.periodEnd ?? row.first?.periodEnd, row]));
  const periods = [...revenueByPeriod.keys()].sort();
  const points: LogMarketRevenuePoint[] = [];
  for (let i = 1; i < periods.length; i++) {
    const anchor = periods[i], previousAnchor = periods[i - 1];
    const revenue = availableAtAnchor(revenueByPeriod.get(previousAnchor), anchor);
    if (!revenue?.sourceFiled || revenue.sourceFiled > anchor || revenue.val === null || revenue.val <= 0) continue;
    const share = latestAvailableAtOrBefore([...shareByPeriod.values()], anchor) ?? latestAvailableAtOrBefore([...weightedByPeriod.values()], anchor);
    if (!share?.sourceFiled || share.sourceFiled > anchor || share.val === null || share.val <= 0) continue;
    const close = closeAt(priceRows, anchor);
    if (close === null || close <= 0) continue;
    const marketCap = share.val * close;
    if (marketCap <= 0) continue;
    points.push({
      cik: company.cik,
      anchor,
      previousAnchor,
      lnRevenue: Math.log(revenue.val),
      lnMarketCap: Math.log(marketCap),
      sector: sectorByCik.get(company.cik) ?? null,
    });
  }
  const evaluation = expandingLogOls(points, 20);
  const metrics = expandingMetrics(evaluation.predictions);
  companyResults.push({ ticker: company.ticker, cik: company.cik, sector: sectorByCik.get(company.cik) ?? null, points: points.length, evaluation, metrics });
  allPoints.push(...points);
  console.log(`[market-cap-ols ${index + 1}/${universe.length}] ${company.ticker}: ${points.length} points / ${evaluation.predictions.length} OOS predictions · R²=${metrics.r2?.toFixed(3) ?? "n/a"} · RMSE=${metrics.rmseUsdMillion?.toFixed(1) ?? "n/a"}M`);
}

const generatedAt = new Date().toISOString();
const datasetSha256 = createHash("sha256").update(JSON.stringify(allPoints)).digest("hex");
const universeSha256 = createHash("sha256").update(readFileSync("worker/research-universe-50.json", "utf8")).digest("hex");
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const metricValues = (key: "r2" | "rmseLog" | "rmseUsdMillion" | "ePlus" | "eMinus" | "balancedAcc") => companyResults.map((result) => result.metrics[key]).filter((value): value is number => value !== null && Number.isFinite(value));
const summary = {
  companies: companyResults.length,
  points: allPoints.length,
  predictions: companyResults.reduce((sum, result) => sum + result.evaluation.predictions.length, 0),
  companiesWithPredictions: companyResults.filter((result) => result.evaluation.predictions.length > 0).length,
  medianR2: median(metricValues("r2")),
  medianRmseLog: median(metricValues("rmseLog")),
  medianRmseUsdMillion: median(metricValues("rmseUsdMillion")),
  medianEPlus: median(metricValues("ePlus")),
  medianEMinus: median(metricValues("eMinus")),
  medianBalancedAcc: median(metricValues("balancedAcc")),
};
const sectors = [...new Set(companyResults.map((result) => result.sector))].sort();
const sectorSummary = sectors.map((sector) => {
  const rows = companyResults.filter((result) => result.sector === sector);
  const values = (key: Parameters<typeof metricValues>[0]) => rows.map((result) => result.metrics[key]).filter((value): value is number => value !== null && Number.isFinite(value));
  return { sector, companies: rows.length, medianR2: median(values("r2")), medianRmseLog: median(values("rmseLog")), medianEPlus: median(values("ePlus")), medianEMinus: median(values("eMinus")), medianBalancedAcc: median(values("balancedAcc")) };
});
const report = {
  schemaVersion: 1,
  generatedAt,
  dataMode: "research_evidence_only",
  model: "ln(MarketCap_t) = alpha + beta × ln(Revenue_{t-1}) + epsilon, expanding window with one-step-ahead predictions",
  protocol: {
    universe: "worker/research-universe-50.json",
    universeSha256,
    datasetSha256,
    minTrainSize: 20,
    priceEligibility: "Observation date <= anchor and fetchedAt <= evaluation asOf; one source per date, Schwab preferred and Stooq historical backfill allowed. Backfill ingestion timestamps are not treated as market-availability dates",
    fundamentalEligibility: "Revenue and shares use latest/first rows only when sourceFiled <= anchor; no future revisions",
    target: "MarketCap_t = sharesOutstanding_t × eligibleClose_t; revenue is the previous quarter's standalone flow",
    errors: "ei+ = P(wrong up | actual down), ei- = P(wrong down | actual up) using predicted and actual log changes",
    promotion: "Evidence only; no model or production promotion",
  },
  summary,
  sectorSummary,
  companies: companyResults,
};
writeFileSync("public/reports/market-cap-ols-evaluation.json", `${JSON.stringify(report, null, 2)}\n`);

const fmt = (value: number | null, digits = 3) => value === null ? "—" : value.toFixed(digits);
const lines = [
  "# Market Cap vs Revenue · expanding log-log OLS",
  "",
  `Generated: ${generatedAt}`,
  "",
  "Model: `ln(MarketCap_t) = α + β·ln(Revenue_{t-1}) + ε`, retrained at every one-step-ahead point using only earlier observations. First 20 quarters are the initial training window.",
  "",
  "`ei+` means wrong-up conditional on actual down; `ei-` means wrong-down conditional on actual up. R² is out-of-sample and may be negative. RMSE is reported in log space and USD millions.",
  "",
  `Usable predictions: ${summary.predictions} across ${summary.companiesWithPredictions}/${summary.companies} companies.`,
  "",
  `Median OOS R²: ${fmt(summary.medianR2)} · median log RMSE: ${fmt(summary.medianRmseLog)} · median USD RMSE: ${fmt(summary.medianRmseUsdMillion, 1)}M · median ei+: ${fmt(summary.medianEPlus)} · median ei-: ${fmt(summary.medianEMinus)} · median balanced accuracy: ${fmt(summary.medianBalancedAcc)}.`,
  "",
  "Median is used instead of selecting the best company. Negative R² values are preserved and are not evidence of causality.",
  "",
  "| Ticker | n | R² | RMSE log | RMSE $M | ei+ | ei- | Balanced | Majority |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...companyResults.map((result) => `| ${result.ticker} | ${result.metrics.n} | ${fmt(result.metrics.r2)} | ${fmt(result.metrics.rmseLog)} | ${fmt(result.metrics.rmseUsdMillion, 1)} | ${fmt(result.metrics.ePlus)} | ${fmt(result.metrics.eMinus)} | ${fmt(result.metrics.balancedAcc)} | ${fmt(result.metrics.majorityBaseline)} |`),
  "",
  "",
  "| Sector | Companies | Median R² | Median log RMSE | Median ei+ | Median ei- | Median balanced |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...sectorSummary.map((row) => `| ${row.sector} | ${row.companies} | ${fmt(row.medianR2)} | ${fmt(row.medianRmseLog)} | ${fmt(row.medianEPlus)} | ${fmt(row.medianEMinus)} | ${fmt(row.medianBalancedAcc)} |`),
  "",
  "Evidence only. Negative R² values are preserved. This is not a probability or production model.",
];
writeFileSync("public/reports/market-cap-ols-evaluation.md", `${lines.join("\n")}\n`);
console.log(JSON.stringify({ generatedAt, datasetSha256, summary, report: "public/reports/market-cap-ols-evaluation.json" }, null, 2));
await db.$client.end();
