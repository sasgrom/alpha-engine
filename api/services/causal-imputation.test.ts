import { describe, expect, it } from "vitest";
import { buildCausalImputationReport, linearTrendForecast } from "./causal-imputation";
import type { RecentGapDiagnosisReport } from "./edgar-recent-gap-diagnosis";
import type { FundamentalSeriesRow } from "./fundamental-integrity";

const diagnosis: RecentGapDiagnosisReport = {
  schemaVersion: 1,
  generatedAt: "2026-11-01T00:00:00Z",
  sourceGapGeneratedAt: "2026-10-31T00:00:00Z",
  sourceFactsSha256: "abc",
  cik: 320193,
  summary: {
    recentErrors: 1,
    cadenceExpectedIssues: 0,
    concepts: 1,
    missingQuarters: 1,
    recoverableQuarters: 0,
    aliasQuarters: 0,
    unavailableQuarters: 1,
    annualOnlyConcepts: 0,
    annualOnlyQuarters: 0,
    quarterlyReviewConcepts: 1,
    quarterlyReviewQuarters: 1,
  },
  gaps: [{
    concept: "Example",
    status: "unavailable",
    lastAvailable: "2024Q1",
    recentQuarters: ["2023Q1"],
    recoverableQuarters: [],
    aliasQuarters: [],
    unavailableQuarters: ["2023Q1"],
    cadence: "quarterly_or_mixed",
    forms: ["10-Q"],
    recentFactCount: 6,
    cadenceAction: "evaluate_isolated_gaps",
    reason: "test gap",
  }],
};

const row = (periodEnd: string, val: number, sourceFiled: string): FundamentalSeriesRow => ({
  id: 1,
  cik: 320193,
  concept: "Example",
  kind: "stock",
  periodEnd,
  vintage: "latest",
  val,
  unit: "USD",
  derivation: "reported",
  sourceAccn: "accn",
  sourceFiled,
});

const actuals = [
  row("2022-03-31", 2.3, "2022-05-01"),
  row("2022-06-30", 2.5, "2022-08-01"),
  row("2022-09-30", 2.7, "2022-11-01"),
  row("2022-12-31", 3.7, "2023-02-01"),
  row("2023-06-30", 3.1, "2023-08-01"),
];

describe("causal quarterly imputation", () => {
  it("reproduces the OLS4 example without using the future actual", () => {
    const trend = linearTrendForecast([2.3, 2.5, 2.7, 3.7]);
    expect(trend.slope).toBeCloseTo(0.44);
    expect(trend.intercept).toBeCloseTo(1.7);
    expect(trend.forecast).toBeCloseTo(3.9);
  });

  it("separates the causal value from the availability-anchored retrospective smoother", () => {
    const report = buildCausalImputationReport(diagnosis, actuals, "2026-11-01T01:00:00Z");
    expect(report.summary.candidateQuarters).toBe(1);
    const candidate = report.quarters[0];
    expect(candidate.causal?.value).toBeCloseTo(3.9);
    expect(candidate.causal?.usesFutureObservation).toBe(false);
    expect(candidate.causal?.availableAt).toBe("2023-08-01");
    expect(candidate.retrospective?.value).toBeCloseTo(3.5);
    expect(candidate.retrospective?.usesFutureObservation).toBe(true);
    expect(candidate.retrospective?.availableAt).toBe("2023-08-01");
    expect(report.policy.rawSeriesChanged).toBe(false);
  });

  it("does not fill tail gaps or use observations filed after the availability anchor", () => {
    const tailDiagnosis = { ...diagnosis, gaps: [{ ...diagnosis.gaps[0], recentQuarters: ["2023Q4"], unavailableQuarters: ["2023Q4"] }] };
    const tail = buildCausalImputationReport(tailDiagnosis, actuals, "2026-11-01T01:00:00Z");
    expect(tail.quarters[0].status).toBe("skipped");
    const latePrior = actuals.map((row, index) => index === 3 ? { ...row, sourceFiled: "2023-12-01" } : row);
    const late = buildCausalImputationReport(diagnosis, latePrior, "2026-11-01T01:00:00Z");
    expect(late.quarters[0].status).toBe("skipped");
    expect(late.quarters[0].reason).toContain("Four consecutive");
  });

  it("excludes annual-only concepts from quarterly imputation", () => {
    const annualDiagnosis = {
      ...diagnosis,
      summary: { ...diagnosis.summary, annualOnlyConcepts: 1, annualOnlyQuarters: 1, quarterlyReviewConcepts: 0 },
      gaps: [{ ...diagnosis.gaps[0], cadence: "annual_only" as const, cadenceAction: "exclude_from_quarterly_imputation" as const }],
    };
    const report = buildCausalImputationReport(annualDiagnosis, actuals, "2026-11-01T01:00:00Z");
    expect(report.summary.annualExcludedQuarters).toBe(1);
    expect(report.summary.evaluatedQuarters).toBe(0);
    expect(report.quarters).toEqual([]);
  });
});
