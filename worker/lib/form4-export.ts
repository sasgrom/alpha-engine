import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { form4CacheRoot, form4QaRunsRoot } from "./cache-root";
import { loadReviewedPriceBars, type Form4Owner, type Form4Transaction } from "./form4-core";
import { form4AffiliatedOwnerKeys, form4ExclusionReason, type InsiderBuyCluster } from "./form4-features";
import { latestCompletedSchwabDailyDate } from "./schwab-daily";
import { writeJsonAtomic } from "./json-file";

export interface Form4ExportOptions {
  root?: string;
  qaRoot?: string;
  universeFile?: string;
  out?: string;
  fullOut?: string;
  previousBenchmarkFile?: string;
  previousRecentBenchmarkFile?: string;
  now?: Date;
  expectedUniverse?: number;
}

function readJson<T>(file: string): T {
  if (!existsSync(file)) throw new Error(`Required Form 4 full-run artifact is missing: ${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function primaryOwner(transaction: Form4Transaction): Form4Owner {
  return {
    ownerCik: transaction.ownerCik,
    rptOwnerName: transaction.rptOwnerName,
    isDirector: transaction.isDirector,
    isOfficer: transaction.isOfficer,
    isTenPercentOwner: transaction.isTenPercentOwner,
    isOther: false,
    officerTitle: transaction.officerTitle,
    otherText: null,
  };
}

function clusterIdFor(transaction: Form4Transaction, clusters: InsiderBuyCluster[]): string | null {
  if (form4ExclusionReason(transaction) !== null) return null;
  const candidates = clusters.filter((cluster) => cluster.accessionNos.includes(transaction.accessionNo)
    && transaction.eventTs >= cluster.windowStart && transaction.eventTs <= cluster.windowEnd);
  if (candidates.length > 1) throw new Error(`Ambiguous Form 4 cluster assignment: ${transaction.ticker}/${transaction.accessionNo}/${transaction.eventTs}`);
  return candidates[0]?.clusterId ?? null;
}

function isIncludedPurchase(transaction: any): boolean {
  return transaction.exclusionReason === null && transaction.acquiredDisposedCode === "A"
    && transaction.shares !== null && transaction.pricePerShare !== null;
}

function aggregateTransactions(transactions: any[]) {
  const included = transactions.filter(isIncludedPurchase);
  const excluded = transactions.filter((row) => !isIncludedPurchase(row));
  const owners = new Set(included.flatMap(form4AffiliatedOwnerKeys));
  return {
    openMarketBuyCount: included.length,
    openMarketBuyUsd: included.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0),
    excludedCount: excluded.length,
    excludedUsd: excluded.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0),
    uniqueInsidersBuying: owners.size,
    multiOwnerTransactions: transactions.filter((row) => row.multiOwner).length,
  };
}

function assertBenchmarkCoverage(benchmark: any, totals: { clusters: number }) {
  for (const [horizon, value] of Object.entries<any>(benchmark.horizons ?? {})) {
    if (value.counts?.total !== totals.clusters) throw new Error(`Form 4 benchmark ${horizon} covers ${value.counts?.total ?? "unknown"} clusters instead of ${totals.clusters}`);
  }
}

export function buildForm4ServingArtifact(options: Form4ExportOptions = {}) {
  const root = options.root ?? form4CacheRoot();
  const qaRoot = options.qaRoot ?? form4QaRunsRoot();
  const universeFile = options.universeFile ?? "worker/research-universe-50.json";
  const universe = readJson<{ cik: number; ticker: string }[]>(universeFile);
  const expectedUniverse = options.expectedUniverse ?? 50;
  if (universe.length !== expectedUniverse || new Set(universe.map((company) => company.cik)).size !== expectedUniverse) {
    throw new Error(`Form 4 full run requires ${expectedUniverse} unique companies`);
  }

  const parse = readJson<any>(path.join(root, "parse-summary.json"));
  const features = readJson<any>(path.join(root, "features-summary.json"));
  const qa = readJson<any>(path.join(qaRoot, "summary.json"));
  const benchmark = readJson<any>(path.join(qaRoot, "benchmark-summary.json"));
  const previousBenchmarkFile = options.previousBenchmarkFile ?? path.join(qaRoot, "benchmark-summary-2026-11-10T06-49-42Z.json");
  const previousBenchmark = readJson<any>(previousBenchmarkFile);
  const previousRecentBenchmarkFile = options.previousRecentBenchmarkFile ?? path.join(qaRoot, "benchmark-summary-2026-11-10T21-36-16Z.json");
  const previousRecentBenchmark = readJson<any>(previousRecentBenchmarkFile);
  if (qa.status !== "passed" || qa.strictQa !== true) throw new Error("Form 4 export requires passed strict QA");
  if (benchmark.dryRun !== true || benchmark.notProductionAlpha !== true || previousBenchmark.dryRun !== true || previousBenchmark.notProductionAlpha !== true || previousRecentBenchmark.dryRun !== true || previousRecentBenchmark.notProductionAlpha !== true) {
    throw new Error("Form 4 export requires honest dry-run benchmarks");
  }
  if (!Array.isArray(parse.companies) || !Array.isArray(features.companies) || parse.errors?.length) throw new Error("Form 4 parse summary is incomplete");

  const parseByTicker = new Map(parse.companies.map((row: any) => [row.ticker, row]));
  const featuresByTicker = new Map(features.companies.map((row: any) => [row.ticker, row]));
  const transactions: any[] = [];
  const clusters: InsiderBuyCluster[] = [];
  for (const company of universe) {
    const parseEntry: any = parseByTicker.get(company.ticker);
    const featureEntry: any = featuresByTicker.get(company.ticker);
    if (!parseEntry || !featureEntry || parseEntry.errors?.length || featureEntry.partial !== 0) {
      throw new Error(`Form 4 full-run summary is incomplete for ${company.ticker}`);
    }
    const transactionDocument = readJson<any>(path.join(root, String(company.cik), "transactions.json"));
    const featureDocument = readJson<any>(path.join(root, String(company.cik), "features.json"));
    if (transactionDocument.issuerCik !== company.cik || transactionDocument.ticker !== company.ticker
      || featureDocument.issuerCik !== company.cik || featureDocument.ticker !== company.ticker
      || transactionDocument.transactions.length !== parseEntry.transactions
      || featureDocument.clusters.length !== featureEntry.clusters) {
      throw new Error(`Form 4 per-company evidence mismatch for ${company.ticker}`);
    }
    for (const transaction of transactionDocument.transactions as Form4Transaction[]) {
      const owners = transaction.owners?.length ? transaction.owners : [primaryOwner(transaction)];
      if (!transaction.availableAt || !transaction.sourceUrl.startsWith("https://www.sec.gov/") || !owners.length) {
        throw new Error(`Form 4 transaction lineage is incomplete for ${company.ticker}/${transaction.accessionNo}`);
      }
      transactions.push({
        accessionNo: transaction.accessionNo,
        issuerCik: transaction.issuerCik,
        ticker: company.ticker,
        ...(transaction.ticker !== company.ticker ? { sourceTicker: transaction.ticker } : {}),
        eventTs: transaction.eventTs,
        availableAt: transaction.availableAt,
        isAmendment: transaction.isAmendment,
        amendmentOf: transaction.amendmentOf,
        transactionCode: transaction.transactionCode,
        transactionFormType: transaction.transactionFormType,
        equitySwapInvolved: transaction.equitySwapInvolved,
        shares: transaction.shares,
        pricePerShare: transaction.pricePerShare,
        valueUsd: transaction.valueUsd,
        acquiredDisposedCode: transaction.acquiredDisposedCode,
        directOrIndirect: transaction.directOrIndirect,
        natureOfOwnership: transaction.natureOfOwnership,
        sharesOwnedAfter: transaction.sharesOwnedAfter,
        ownerCik: transaction.ownerCik,
        owners,
        multiOwner: transaction.multiOwner === true,
        rptOwnerName: transaction.rptOwnerName,
        isDirector: transaction.isDirector,
        isOfficer: transaction.isOfficer,
        isTenPercentOwner: transaction.isTenPercentOwner,
        officerTitle: transaction.officerTitle,
        exclusionReason: form4ExclusionReason(transaction),
        sourceUrl: transaction.sourceUrl,
        clusterId: clusterIdFor(transaction, featureDocument.clusters),
      });
    }
    clusters.push(...featureDocument.clusters.map((cluster) => ({
      ...cluster,
      ticker: company.ticker,
      ...(cluster.ticker !== company.ticker ? { sourceTicker: cluster.ticker } : {}),
    })));
  }

  const totals = {
    accessions: parse.companies.reduce((sum: number, row: any) => sum + row.accessions, 0),
    transactions: parse.companies.reduce((sum: number, row: any) => sum + row.transactions, 0),
    clusters: features.companies.reduce((sum: number, row: any) => sum + row.clusters, 0),
  };
  if (transactions.length !== totals.transactions || clusters.length !== totals.clusters
    || new Set(clusters.map((cluster) => cluster.clusterId)).size !== totals.clusters) {
    throw new Error("Form 4 serving totals do not match the full-run summaries");
  }
  if (benchmark.methodology === "canonical_dailyPrice_v1") assertBenchmarkCoverage(benchmark, totals);
  if (previousBenchmark.priceCoverage?.status !== "degraded" || previousBenchmark.priceCoverage?.latestDate !== "2026-11-06") {
    throw new Error("The earlier Form 4 benchmark must preserve its degraded 2026-11-06 price coverage");
  }
  const latestCompletedDate = latestCompletedSchwabDailyDate(options.now ?? new Date());
  const latestPriceDate = benchmark.priceCoverage?.latestDate ?? universe.reduce((latest, company) => {
    const bars = (loadReviewedPriceBars(company.ticker) ?? []).filter((bar) => bar.date <= latestCompletedDate);
    return bars.length && bars.at(-1)!.date > latest ? bars.at(-1)!.date : latest;
  }, "");
  if (!latestPriceDate) throw new Error("Current Form 4 benchmark price coverage is unavailable");
  transactions.sort((a, b) => b.availableAt.localeCompare(a.availableAt) || a.accessionNo.localeCompare(b.accessionNo));
  clusters.sort((a, b) => b.availableAt.localeCompare(a.availableAt) || a.clusterId.localeCompare(b.clusterId));
  return {
    schemaVersion: 1,
    status: "full_run" as const,
    generatedAt: (options.now ?? new Date()).toISOString(),
    universe: universe.length,
    totals,
    transactions,
    clusters,
    benchmarkRuns: [
      {
        generatedAt: previousBenchmark.generatedAt,
        dryRun: true,
        notProductionAlpha: true,
        methodologyStatus: "invalid-methodology",
        priceCoverage: previousBenchmark.priceCoverage,
        horizons: previousBenchmark.horizons,
      },
      {
        generatedAt: previousRecentBenchmark.generatedAt,
        dryRun: true,
        notProductionAlpha: true,
        methodologyStatus: "invalid-methodology",
        priceCoverage: previousRecentBenchmark.priceCoverage ?? { status: "current", latestDate: "2026-11-09" },
        horizons: previousRecentBenchmark.horizons,
      },
      {
        generatedAt: benchmark.generatedAt,
        dryRun: true,
        notProductionAlpha: true,
        methodologyStatus: benchmark.methodology === "canonical_dailyPrice_v1" ? "canonical" : "invalid-methodology",
        priceCoverage: { status: "current", latestDate: latestPriceDate },
        maxEntryGapDays: benchmark.priceEvidence?.maxEntryGapDays,
        horizons: benchmark.horizons,
        coverageByYear: benchmark.coverageByYear,
      },
    ],
  };
}

export function buildSlimForm4Artifact(full: ReturnType<typeof buildForm4ServingArtifact>) {
  const perTicker = new Map<string, any>();
  for (const transaction of full.transactions) {
    if (!perTicker.has(transaction.ticker)) perTicker.set(transaction.ticker, { ticker: transaction.ticker, transactions: [] });
    perTicker.get(transaction.ticker).transactions.push(transaction);
  }
  return {
    schemaVersion: 1,
    status: full.status,
    generatedAt: full.generatedAt,
    universe: full.universe,
    totals: full.totals,
    kpi: aggregateTransactions(full.transactions),
    perTicker: [...perTicker.values()].map((entry) => {
      const aggregates = aggregateTransactions(entry.transactions);
      const { transactions: _transactions, ...ticker } = entry;
      return { ...ticker, ...aggregates, clusters: full.clusters.filter((cluster) => cluster.ticker === entry.ticker).length };
    }).sort((a, b) => a.ticker.localeCompare(b.ticker)),
    transactions: full.transactions.slice(0, 500),
    clusters: full.clusters,
    benchmarkRuns: full.benchmarkRuns,
  };
}

export function exportForm4ServingArtifact(options: Form4ExportOptions = {}) {
  const full = buildForm4ServingArtifact(options);
  const slim = buildSlimForm4Artifact(full);
  const fullBody = JSON.stringify(full);
  const slimBody = JSON.stringify(slim);
  const fullOut = path.resolve(options.fullOut ?? "worker/.runs/insider-form4-full.json");
  const out = path.resolve(options.out ?? "public/reports/insider-form4.json");
  writeJsonAtomic(fullOut, full);
  writeJsonAtomic(out, slim);
  return {
    out,
    fullOut,
    status: slim.status,
    universe: slim.universe,
    totals: slim.totals,
    servedTransactions: slim.transactions.length,
    multiOwnerTransactions: slim.kpi.multiOwnerTransactions,
    bytes: Buffer.byteLength(slimBody),
    sha256: createHash("sha256").update(slimBody).digest("hex"),
    slimBytes: Buffer.byteLength(slimBody),
    slimSha256: createHash("sha256").update(slimBody).digest("hex"),
    fullBytes: Buffer.byteLength(fullBody),
    fullSha256: createHash("sha256").update(fullBody).digest("hex"),
  };
}
