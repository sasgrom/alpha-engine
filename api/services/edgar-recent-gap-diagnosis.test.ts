import { describe, expect, it } from "vitest";
import { diagnoseRecentGaps } from "./edgar-recent-gap-diagnosis";
import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
import type { IntegrityIssue } from "./fundamental-integrity";

const analysis: EdgarGapAnalysis = {
  schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", sourceGeneratedAt: "2026-10-30T00:00:00Z", since: "2000-01-01",
  summary: { errors: 3, warnings: 0, continuityIssues: 3, continuityQuarters: 3, excludedPre2000: 0 },
  byType: [], byCik: [], byEra: [], omittedGaps: 0,
  gaps: [
    { cik: 320193, concept: "AssetsCurrent", missingQuarters: ["2020Q1"], firstMissingPeriod: "2020Q1", lastMissingPeriod: "2020Q1", recommendedAction: "refresh" },
    { cik: 320193, concept: "FinanceLeaseLiabilityCurrent", missingQuarters: ["2020Q2"], firstMissingPeriod: "2020Q2", lastMissingPeriod: "2020Q2", recommendedAction: "refresh" },
    { cik: 320193, concept: "UnavailableConcept", missingQuarters: ["2020Q3"], firstMissingPeriod: "2020Q3", lastMissingPeriod: "2020Q3", recommendedAction: "refresh" },
  ],
};
const sourceIssues: IntegrityIssue[] = analysis.gaps.map((gap) => ({
  severity: "error",
  type: "continuity_gap",
  cik: gap.cik,
  concept: gap.concept,
  periodEnd: "2020-09-30",
  message: "recent continuity gap",
}));
const companyFacts = {
  facts: {
    "us-gaap": {
      AssetsCurrent: { units: { USD: [{ end: "2020-03-31" }] } },
      FinanceLeaseLiabilityNoncurrent: { units: { USD: [{ end: "2020-06-30" }] } },
    },
  },
};

describe("recent EDGAR gap diagnosis", () => {
  it("separates exact recovery, alias candidates and unavailable quarters", () => {
    const report = diagnoseRecentGaps(analysis, sourceIssues, companyFacts, 320193, "abc", "2026-10-31T01:00:00Z");
    expect(report.gaps.map((gap) => gap.status)).toEqual(["recoverable", "alias_candidate", "unavailable"]);
    expect(report.summary.recentErrors).toBe(3);
    expect(report.summary.missingQuarters).toBe(3);
    expect(report.summary.recoverableQuarters).toBe(1);
    expect(report.summary.aliasQuarters).toBe(1);
    expect(report.summary.unavailableQuarters).toBe(1);
    expect(report.gaps[0].unavailableQuarters).toEqual([]);
    expect(report.gaps[1].reason).toContain("Current/Noncurrent twin");
    expect(report.gaps[1].reason).toContain("FinanceLeaseLiabilityNoncurrent");
    expect(report.gaps[2].reason).toContain("repeated download cannot restore");
  });

  it("ignores other companies and pre-2020 quarters", () => {
    const scoped: EdgarGapAnalysis = {
      ...analysis,
      gaps: [
        ...analysis.gaps,
        { ...analysis.gaps[0], cik: 999, concept: "OtherCompany" },
        { ...analysis.gaps[0], concept: "OldGap", missingQuarters: ["2019Q4"], firstMissingPeriod: "2019Q4", lastMissingPeriod: "2019Q4" },
      ],
    };
    const scopedIssues: IntegrityIssue[] = [
      ...sourceIssues,
      { ...sourceIssues[0], cik: 999, concept: "OtherCompany" },
      { ...sourceIssues[0], concept: "OldGap", periodEnd: "2019-12-31" },
    ];
    const report = diagnoseRecentGaps(scoped, scopedIssues, companyFacts, 320193, "abc", "2026-10-31T01:00:00Z");
    expect(report.cik).toBe(320193);
    expect(report.summary.concepts).toBe(3);
    expect(report.gaps.some((gap) => ["OtherCompany", "OldGap"].includes(gap.concept))).toBe(false);
  });
});
