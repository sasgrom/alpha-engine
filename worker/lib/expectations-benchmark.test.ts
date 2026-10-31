import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExpectationStatement } from "./expectations";
import { evaluateExpectationBenchmark, type BenchmarkFile, type ExtractionForBenchmark, type GoldStatement } from "./expectations-benchmark";

const benchmark = JSON.parse(readFileSync("research/expectations-benchmark-v1.json", "utf8")) as BenchmarkFile;
const fromGold = (gold: GoldStatement): ExpectationStatement => ({
  kind: gold.kind ?? "guidance",
  metricRaw: gold.metric,
  metric: gold.metric,
  scopeRaw: gold.scopeAny[0],
  periodRaw: gold.periodAny[0],
  comparisonRaw: null,
  qualifier: gold.qualifier,
  valueLow: gold.low ?? null,
  valueHigh: gold.high ?? null,
  valuePoint: gold.point ?? null,
  tolerance: gold.tolerance ?? null,
  toleranceUnit: gold.toleranceUnit ?? null,
  valueText: null,
  unit: gold.unit ?? "text",
  basis: gold.basis ?? "reported",
  currencyBasis: gold.currencyBasis ?? "reported",
  revision: gold.revision ?? (gold.kind === "non_disclosure" ? "not_provided" : "initial"),
  previousLow: gold.previousLow ?? null,
  previousHigh: gold.previousHigh ?? null,
  previousPoint: gold.previousPoint ?? null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: null,
  evidence: "A sufficiently long verbatim source quote for benchmark testing",
});
const perfect = () => new Map<string, ExtractionForBenchmark>(benchmark.documents.map((doc) => [doc.accessionNo, {
  accessionNo: doc.accessionNo,
  guidanceStatus: doc.expectedGuidanceStatus,
  statements: doc.required.map(fromGold),
}]));

describe("independent expectations benchmark", () => {
  it("covers all value forms across twelve official documents", () => {
    expect(benchmark.documents).toHaveLength(12);
    expect(benchmark.documents.reduce((sum, doc) => sum + doc.required.length, 0)).toBe(27);
    expect(new Set(benchmark.documents.map((doc) => doc.accessionNo)).size).toBe(12);
    expect(benchmark.documents.some((doc) => doc.expectedGuidanceStatus === "deferred_to_call")).toBe(true);
    expect(benchmark.documents.some((doc) => doc.expectedGuidanceStatus === "not_found")).toBe(true);
  });

  it("matches the complete required subset without treating extra statements as errors", () => {
    const extractions = perfect();
    const first = benchmark.documents[0];
    extractions.get(first.accessionNo)!.statements.push(fromGold(first.required[0]));
    const report = evaluateExpectationBenchmark(benchmark, extractions);
    expect(report.requiredStatements).toBe(27);
    expect(report.matchedStatements).toBe(27);
    expect(report.recall).toBe(1);
    expect(report.extraStatementsForReview).toBe(1);
    expect(report.pass).toBe(true);
  });

  it("fails closed on wrong values, status and missing results", () => {
    const extractions = perfect();
    const first = benchmark.documents[0];
    extractions.get(first.accessionNo)!.guidanceStatus = "not_found";
    extractions.get(first.accessionNo)!.statements[0].valueLow = 999;
    extractions.delete(benchmark.documents[1].accessionNo);
    const report = evaluateExpectationBenchmark(benchmark, extractions);
    expect(report.pass).toBe(false);
    expect(new Set(report.issues.map((issue) => issue.code))).toEqual(new Set(["status_mismatch", "value_mismatch", "missing_result"]));
  });
});
