import { describe, expect, it } from "vitest";
import { auditFactorPoints, auditFundamentalFacts, auditSeriesPoints, buildFundamentalIntegrityReport, type FundamentalFactRow, type FundamentalSeriesRow, type FundamentalFactorRow } from "./fundamental-integrity";

let nextId = 1;
const fact = (concept: string, endDate: string, extra: Partial<FundamentalFactRow> = {}): FundamentalFactRow => ({
  id: nextId++, cik: 1, taxonomy: "us-gaap", concept, unit: "USD", startDate: ["NetIncomeLoss", "NetCashProvidedByUsedInOperatingActivities", "RevenueFromContractWithCustomerExcludingAssessedTax", "EarningsPerShareDiluted"].includes(concept) ? endDate === "2024-03-31" ? "2024-01-01" : "2024-04-01" : null, endDate, val: 100,
  fy: 2024, fp: "Q1", form: "10-Q", filed: endDate === "2024-03-31" ? "2024-04-30" : "2024-07-30", accn: "0001-24-000001", ...extra,
});
const series = (concept: string, periodEnd: string, vintage: "first" | "latest", extra: Partial<FundamentalSeriesRow> = {}): FundamentalSeriesRow => ({
  id: nextId++, cik: 1, concept, kind: "stock", periodEnd, vintage, val: 100, unit: "USD", derivation: "reported", sourceAccn: "0001-24-000001", sourceFiled: periodEnd === "2024-03-31" ? "2024-04-30" : "2024-07-30", ...extra,
});
const factor = (periodEnd: string, extra: Partial<FundamentalFactorRow> = {}): FundamentalFactorRow => ({ id: nextId++, cik: 1, factor: "accruals", periodEnd, filedAt: periodEnd === "2024-03-31" ? "2024-04-30" : "2024-07-30", value: 0.1, ...extra });
const conceptNames = ["RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss", "NetCashProvidedByUsedInOperatingActivities", "Assets", "StockholdersEquity", "CommonStockSharesOutstanding", "EarningsPerShareDiluted", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt"];
const cleanFacts = conceptNames.flatMap((concept) => [fact(concept, "2024-03-31"), fact(concept, "2024-06-30")]);
const cleanSeries = conceptNames.flatMap((concept) => [series(concept, "2024-03-31", "first"), series(concept, "2024-03-31", "latest"), series(concept, "2024-06-30", "first"), series(concept, "2024-06-30", "latest")]);
const cleanFactors = [factor("2024-03-31"), factor("2024-06-30")];

describe("fundamental integrity and continuity", () => {
  it("passes a complete, unit-stable, continuous panel", () => {
    const report = buildFundamentalIntegrityReport({ facts: cleanFacts, series: cleanSeries, factors: cleanFactors, universeSha256: "abc", generatedAt: "2026-10-31T00:00:00Z" });
    expect(report.status).toBe("pass");
    expect(report.summary.errors).toBe(0);
    expect(report.summary.continuityGaps).toBe(0);
  });

  it("rejects exact duplicates and conflicting values inside one accession", () => {
    const original = fact("Assets", "2024-03-31");
    const duplicate = { ...original, id: nextId++ };
    const conflict = { ...original, id: nextId++, val: 101 };
    const issues = auditFundamentalFacts([original, duplicate, conflict]);
    expect(issues.some((issue) => issue.type === "duplicate_fact")).toBe(true);
    expect(issues.some((issue) => issue.type === "frame_conflict")).toBe(true);
  });

  it("distinguishes unit changes from incompatible units in the same period", () => {
    const issues = auditFundamentalFacts([
      fact("Assets", "2024-03-31", { unit: "USD" }), fact("Assets", "2024-06-30", { unit: "shares" }),
    ]);
    expect(issues.some((issue) => issue.type === "unit_change" && issue.severity === "warning")).toBe(true);
    const conflicts = auditFundamentalFacts([
      fact("Assets", "2024-03-31", { unit: "USD" }), fact("Assets", "2024-03-31", { unit: "shares" }),
    ]);
    expect(conflicts.some((issue) => issue.type === "unit_conflict" && issue.severity === "error")).toBe(true);
  });

  it("fails missing quarters rather than interpolating them", () => {
    const issues = auditFundamentalFacts([fact("Assets", "2024-03-31"), fact("Assets", "2024-09-30", { filed: "2024-10-30" })]);
    expect(issues.some((issue) => issue.type === "continuity_gap" && issue.message.includes("2024Q2"))).toBe(true);
  });

  it("treats annual-only disclosure as cadence, not a quarterly continuity error", () => {
    const annualFacts = [
      fact("Assets", "2023-12-31", { form: "10-K", filed: "2024-02-01" }),
      fact("Assets", "2024-12-31", { form: "10-K", filed: "2025-02-01" }),
    ];
    const annualSeries = [
      series("Assets", "2023-12-31", "first", { sourceFiled: "2024-02-01" }),
      series("Assets", "2024-12-31", "latest", { sourceFiled: "2025-02-01" }),
    ];
    const report = buildFundamentalIntegrityReport({ facts: annualFacts, series: annualSeries, factors: [], universeSha256: "abc", generatedAt: "2026-10-31T00:00:00Z" });
    expect(report.summary.errors).toBe(0);
    expect(report.summary.continuityGaps).toBe(0);
    expect(report.issues.filter((issue) => issue.type === "cadence_expected_gap")).toHaveLength(2);
    expect(report.issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("rejects availability and factor-before-fact inversions", () => {
    const inverted = fact("Assets", "2024-03-31", { filed: "2024-03-01" });
    expect(auditFundamentalFacts([inverted]).some((issue) => issue.type === "availability_inversion")).toBe(true);
    const earlyFactor = factor("2024-03-31", { filedAt: "2024-03-01" });
    expect(auditFactorPoints([earlyFactor], [fact("Assets", "2024-03-31")]).some((issue) => issue.type === "factor_before_fact")).toBe(true);
  });

  it("does not compare market factors with unrelated fundamental fact availability", () => {
    const marketRows = [
      factor("2024-03-31", { factor: "momentum122", filedAt: "2024-03-31 00:00:00" }),
      factor("2024-03-31", { factor: "high52", filedAt: "2024-03-31 00:00:00" }),
    ];
    const issues = auditFactorPoints(marketRows, [fact("Assets", "2024-03-31", { filed: "2024-04-30" })]);
    expect(issues.some((issue) => issue.type === "factor_before_fact")).toBe(false);
  });

  it("flags duplicate series, series availability inversion and large revisions", () => {
    const duplicate = series("Assets", "2024-03-31", "first");
    const issues = auditSeriesPoints([
      duplicate, { ...duplicate, id: nextId++ },
      series("Assets", "2024-03-31", "latest", { val: -200, sourceFiled: "2024-03-01" }),
    ]);
    expect(issues.some((issue) => issue.type === "duplicate_series_point")).toBe(true);
    expect(issues.some((issue) => issue.type === "availability_inversion")).toBe(true);
    expect(issues.some((issue) => issue.type === "revision_outlier")).toBe(true);
  });

  it("keeps omissions explicit when the display cap is reached", () => {
    const original = fact("Assets", "2024-03-31");
    const rows = Array.from({ length: 150 }, () => ({ ...original, id: nextId++ }));
    const report = buildFundamentalIntegrityReport({ facts: rows, series: [], factors: [], universeSha256: "abc", generatedAt: "2026-10-31T00:00:00Z", maxIssues: 100 });
    expect(report.summary.omittedIssues).toBeGreaterThan(0);
    expect(report.issues.length).toBe(100);
    expect(report.status).toBe("fail");
  });
});
