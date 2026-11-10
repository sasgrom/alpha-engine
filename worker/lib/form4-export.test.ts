import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Form4Transaction } from "./form4-core";
import { buildForm4ServingArtifact, buildSlimForm4Artifact, exportForm4ServingArtifact } from "./form4-export";

let root: string;
let qaRoot: string;
let universeFile: string;
let out: string;

const transaction = (overrides: Partial<Form4Transaction> = {}): Form4Transaction => ({
  issuerCik: 1,
  ticker: "AAA",
  accessionNo: "0000000001-26-000001",
  eventTs: "2026-11-02",
  availableAt: "2026-11-04 12:19:10",
  transactionCode: "P",
  transactionFormType: "4",
  equitySwapInvolved: false,
  shares: 100,
  pricePerShare: 25,
  valueUsd: 2500,
  acquiredDisposedCode: "A",
  directOrIndirect: "D",
  natureOfOwnership: "",
  sharesOwnedAfter: 1000,
  percentOwnedAfter: null,
  ownerCik: 10,
  rptOwnerName: "Owner A",
  isDirector: true,
  isOfficer: false,
  isTenPercentOwner: false,
  officerTitle: null,
  footnotes: [],
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/form4.xml",
  inputSha256: "a".repeat(64),
  periodOfReport: "2026-11-02",
  isAmendment: false,
  amendmentOf: null,
  owners: [
    { ownerCik: 10, rptOwnerName: "Owner A", isDirector: true, isOfficer: false, isTenPercentOwner: false, isOther: false, officerTitle: null, otherText: null },
    { ownerCik: 11, rptOwnerName: "Owner B", isDirector: false, isOfficer: true, isTenPercentOwner: false, isOther: false, officerTitle: "CFO", otherText: null },
  ],
  multiOwner: true,
  ownerReference: null,
  ...overrides,
});

const cluster = {
  signal: "insider_buy_cluster_v1",
  clusterId: "insider_buy_cluster_v1:1:2026-11-02:abc",
  issuerCik: 1,
  ticker: "AAA",
  windowStart: "2026-11-02",
  windowEnd: "2026-11-02",
  availableAt: "2026-11-04 12:19:10",
  status: "computed",
  uniqueInsiders: 2,
  uniqueInsidersExcludingMultiOwner: 0,
  multiOwner: true,
  multiOwnerTransactionCount: 1,
  multiOwnerPurchaseUsd: 2500,
  purchaseCountExcludingMultiOwner: 0,
  aggregatePurchaseUsdExcludingMultiOwner: null,
  hasCeo: false,
  hasCfo: true,
  hasDirector: true,
  hasTenPercentOwner: false,
  aggregatePurchaseUsd: 2500,
  maxSinglePurchaseUsd: 2500,
  ownershipIncreasePct: 0.1,
  flipAfterSell90d: false,
  purchaseCount: 1,
  missingValueCount: 0,
  accessionNos: ["0000000001-26-000001"],
  purchaseToMarketCap: { status: "not_computable", value: null },
  purchaseToAdv20: { status: "not_computable", value: null },
  drawdown20d: { status: "not_computable", value: null },
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "form4-export-"));
  qaRoot = path.join(root, "qa");
  mkdirSync(path.join(root, "1"), { recursive: true });
  mkdirSync(path.join(root, "2"), { recursive: true });
  mkdirSync(qaRoot, { recursive: true });
  universeFile = path.join(root, "universe.json");
  out = path.join(root, "insider-form4.json");
  writeFileSync(universeFile, JSON.stringify([{ cik: 1, ticker: "AAA" }, { cik: 2, ticker: "BBB" }]));
  writeFileSync(path.join(root, "1", "transactions.json"), JSON.stringify({ issuerCik: 1, ticker: "AAA", transactions: [transaction({ ticker: "LEGACY" }), transaction({ transactionCode: "M", valueUsd: null, pricePerShare: null })] }));
  writeFileSync(path.join(root, "2", "transactions.json"), JSON.stringify({ issuerCik: 2, ticker: "BBB", transactions: [] }));
  writeFileSync(path.join(root, "1", "features.json"), JSON.stringify({ issuerCik: 1, ticker: "AAA", clusters: [cluster] }));
  writeFileSync(path.join(root, "2", "features.json"), JSON.stringify({ issuerCik: 2, ticker: "BBB", clusters: [] }));
  writeFileSync(path.join(root, "parse-summary.json"), JSON.stringify({ companies: [
    { ticker: "AAA", accessions: 1, transactions: 2, errors: [] },
    { ticker: "BBB", accessions: 0, transactions: 0, errors: [] },
  ], errors: [] }));
  writeFileSync(path.join(root, "features-summary.json"), JSON.stringify({ companies: [
    { ticker: "AAA", clusters: 1, partial: 0 },
    { ticker: "BBB", clusters: 0, partial: 0 },
  ] }));
  writeFileSync(path.join(qaRoot, "summary.json"), JSON.stringify({ status: "passed", strictQa: true }));
  const benchmark = {
    generatedAt: "2026-11-10T12:00:00.000Z",
    dryRun: true,
    notProductionAlpha: true,
    methodology: "canonical_dailyPrice_v1",
    priceEvidence: { source: "local_mysql_dailyPrice", asOf: "2026-11-10T12:00:00.000Z", maxEntryGapDays: 45 },
    priceCoverage: { status: "current", latestDate: "2026-11-09" },
    coverageByYear: [{ year: "2026", total: 1, horizons: { forward1d: { computed: 1, coverage: 1 }, forward5d: { computed: 1, coverage: 1 }, forward20d: { computed: 1, coverage: 1 } } }],
    horizons: {
      forward1d: { counts: { total: 1, computed: 1 }, hitRate: 0.39, medianExcess: -0.005 },
      forward5d: { counts: { total: 1, computed: 1 }, hitRate: 0.41, medianExcess: -0.006 },
      forward20d: { counts: { total: 1, computed: 1 }, hitRate: 0.48, medianExcess: -0.01 },
    },
  };
  writeFileSync(path.join(qaRoot, "benchmark-summary.json"), JSON.stringify(benchmark));
  writeFileSync(path.join(qaRoot, "benchmark-summary-2026-11-10T06-49-42Z.json"), JSON.stringify({
    ...benchmark,
    generatedAt: "2026-11-10T06:49:42.087Z",
    priceCoverage: { status: "degraded", latestDate: "2026-11-06", note: "Price history ended 2026-11-06" },
  }));
  writeFileSync(path.join(qaRoot, "benchmark-summary-2026-11-10T21-36-16Z.json"), JSON.stringify({
    ...benchmark,
    generatedAt: "2026-11-10T21:36:16.094Z",
    methodology: "raw_pricehistory_short_window",
    priceCoverage: { status: "current", latestDate: "2026-11-09" },
  }));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Form 4 full-run serving export", () => {
  it("exports real transactions, owners, exclusions and cluster links with an honest benchmark", () => {
    const artifact = buildForm4ServingArtifact({ root, qaRoot, universeFile, expectedUniverse: 2, now: new Date("2026-11-10T12:00:00Z") });
    expect(artifact.status).toBe("full_run");
    expect(artifact.universe).toBe(2);
    expect(artifact.totals).toEqual({ accessions: 1, transactions: 2, clusters: 1 });
    const excluded = artifact.transactions.find((row) => row.transactionCode === "M");
    const purchase = artifact.transactions.find((row) => row.transactionCode === "P");
    expect(excluded).toMatchObject({ exclusionReason: "option_exercise", clusterId: null, multiOwner: true });
    expect(excluded.owners).toHaveLength(2);
    expect(purchase).toMatchObject({ ticker: "AAA", sourceTicker: "LEGACY", exclusionReason: null, clusterId: cluster.clusterId });
    expect(artifact.benchmarkRuns).toHaveLength(3);
    expect(artifact.benchmarkRuns.slice(0, 2).every((run) => run.methodologyStatus === "invalid-methodology")).toBe(true);
    expect(artifact.benchmarkRuns[2]).toMatchObject({ methodologyStatus: "canonical", maxEntryGapDays: 45 });
    expect(artifact.benchmarkRuns[2].coverageByYear[0]).toMatchObject({ year: "2026", total: 1 });
    expect(artifact.benchmarkRuns[0].horizons.forward20d.hitRate).toBeLessThan(0.5);
    expect(artifact.benchmarkRuns[0].priceCoverage).toMatchObject({ status: "degraded", latestDate: "2026-11-06" });
    expect(artifact.benchmarkRuns[1].priceCoverage).toMatchObject({ status: "current", latestDate: "2026-11-09" });
  });

  it("writes slim serving and full local artifacts only after a complete run and preserves them on failure", () => {
    const result = exportForm4ServingArtifact({ root, qaRoot, universeFile, out, expectedUniverse: 2, now: new Date("2026-11-10T12:00:00Z") });
    const body = readFileSync(out, "utf8");
    const slim = JSON.parse(body);
    expect(result.totals).toEqual({ accessions: 1, transactions: 2, clusters: 1 });
    expect(result.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(result.multiOwnerTransactions).toBe(2);
    expect(slim.transactions).toHaveLength(2);
    expect(slim.kpi).toMatchObject({ openMarketBuyCount: 1, openMarketBuyUsd: 2500, excludedCount: 1, uniqueInsidersBuying: 1, multiOwnerTransactions: 2 });
    expect(slim.perTicker.find((row) => row.ticker === "AAA")).toMatchObject({ openMarketBuyCount: 1, clusters: 1 });
    expect(result.fullSha256).toBe(createHash("sha256").update(readFileSync(result.fullOut, "utf8")).digest("hex"));
    writeFileSync(out, "previous-reviewed-artifact");
    writeFileSync(path.join(qaRoot, "summary.json"), JSON.stringify({ status: "failed", strictQa: true }));
    expect(() => exportForm4ServingArtifact({ root, qaRoot, universeFile, out, expectedUniverse: 2 })).toThrow("passed strict QA");
    expect(readFileSync(out, "utf8")).toBe("previous-reviewed-artifact");
  });

  it("limits only the serving transaction list to 500 while preserving full KPI and clusters", () => {
    const full = buildForm4ServingArtifact({ root, qaRoot, universeFile, expectedUniverse: 2 });
    const transactions = Array.from({ length: 501 }, (_, index) => ({ ...full.transactions[0], accessionNo: `0000000001-26-${String(index).padStart(6, "0")}` }));
    const slim = buildSlimForm4Artifact({ ...full, totals: { ...full.totals, transactions: 501 }, transactions });
    expect(slim.transactions).toHaveLength(500);
    expect(slim.totals.transactions).toBe(501);
    expect(slim.clusters).toHaveLength(1);
    expect(slim.kpi.openMarketBuyCount).toBe(501);
  });

  it("rejects a benchmark from a different-sized run without replacing the serving file", () => {
    writeFileSync(out, "previous-full-run-artifact");
    const benchmark = JSON.parse(readFileSync(path.join(qaRoot, "benchmark-summary.json"), "utf8"));
    benchmark.horizons.forward1d.counts.total = 7;
    writeFileSync(path.join(qaRoot, "benchmark-summary.json"), JSON.stringify(benchmark));
    expect(() => exportForm4ServingArtifact({ root, qaRoot, universeFile, out, expectedUniverse: 2 })).toThrow("instead of 1");
    expect(readFileSync(out, "utf8")).toBe("previous-full-run-artifact");
  });
});
