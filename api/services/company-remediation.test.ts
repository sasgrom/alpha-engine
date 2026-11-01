import { describe, expect, it } from "vitest";
import { buildCompanyRemediationPlan } from "./company-remediation";
import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
import type { RecentGapDiagnosisReport } from "./edgar-recent-gap-diagnosis";
import type { SchwabFundamentalGapMap } from "./schwab-fundamental-gap-map";

const gapAnalysis: EdgarGapAnalysis = {
  schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", sourceGeneratedAt: "2026-10-30T00:00:00Z", since: "2000-01-01",
  summary: { errors: 20, warnings: 3, continuityIssues: 20, continuityQuarters: 30, excludedPre2000: 0 },
  byType: [{ type: "availability_inversion", count: 0 }, { type: "continuity_gap", count: 20 }],
  byCik: [], byEra: [{ era: "2020-2024", errors: 5, warnings: 1 }, { era: "2025-2026", errors: 2, warnings: 0 }, { era: "2010-2019", errors: 13, warnings: 2 }],
  gaps: [], omittedGaps: 0,
};
const gapMap: SchwabFundamentalGapMap = { schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", sourceGapGeneratedAt: "2026-10-31T00:00:00Z", coverage: { direct: 2, derived: 3, unsupported: 15 }, candidates: [] };
const sourceSparseDiagnosis: RecentGapDiagnosisReport = {
  schemaVersion: 1, generatedAt: "2026-10-31T01:00:00Z", sourceGapGeneratedAt: gapAnalysis.generatedAt,
  sourceFactsSha256: "abc", cik: 320193,
  summary: { recentErrors: 7, concepts: 5, missingQuarters: 12, recoverableQuarters: 0, aliasQuarters: 0, unavailableQuarters: 12 },
  gaps: [],
};

describe("company remediation plan", () => {
  it("keeps EDGAR first and stops blind refreshes after source-sparse diagnosis", () => {
    const plan = buildCompanyRemediationPlan({ ticker: "AAPL", gapAnalysis, gapMap, recentGapDiagnosis: sourceSparseDiagnosis, apply: true, strict: true });
    expect(plan.stages).toEqual(["edgar-fetch", "edgar-exhibits", "facts-fetch", "integrity-audit", "gap-analysis", "recent-gap-diagnosis", "schwab-gap-map"]);
    expect(plan.recentErrors).toBe(7);
    expect(plan.nextAction).toBe("review_source_sparse_gaps");
    expect(plan.unavailableQuarters).toBe(12);
  });

  it("routes exact facts to ingestion review and twins to taxonomy review", () => {
    const exact = buildCompanyRemediationPlan({
      ticker: "AAPL", gapAnalysis, gapMap, apply: false, strict: false,
      recentGapDiagnosis: { ...sourceSparseDiagnosis, summary: { ...sourceSparseDiagnosis.summary, recoverableQuarters: 2, unavailableQuarters: 10 } },
    });
    const alias = buildCompanyRemediationPlan({
      ticker: "AAPL", gapAnalysis, gapMap, apply: false, strict: false,
      recentGapDiagnosis: { ...sourceSparseDiagnosis, summary: { ...sourceSparseDiagnosis.summary, aliasQuarters: 3, unavailableQuarters: 9 } },
    });
    expect(exact.nextAction).toBe("review_fact_ingestion");
    expect(alias.nextAction).toBe("review_taxonomy_aliases");
  });

  it("prioritizes availability inversions before any new factor work", () => {
    const withInversions = { ...gapAnalysis, byType: gapAnalysis.byType.map((row) => row.type === "availability_inversion" ? { ...row, count: 2 } : row) };
    const plan = buildCompanyRemediationPlan({ ticker: "AMD", gapAnalysis: withInversions, gapMap, apply: false, strict: true });
    expect(plan.nextAction).toBe("fix_availability_before_factor");
    expect(plan.availabilityInversions).toBe(2);
    expect(plan.stages).not.toContain("edgar-fetch");
  });

  it("uses Schwab candidates only after EDGAR analysis and rejects unsupported replacement", () => {
    const noRecent = { ...gapAnalysis, byEra: [{ era: "2010-2019", errors: 20, warnings: 3 }] };
    const plan = buildCompanyRemediationPlan({ ticker: "NVDA", gapAnalysis: noRecent, gapMap, apply: false, strict: false });
    expect(plan.nextAction).toBe("review_schwab_candidates");
    expect(plan.directCandidates + plan.derivedCandidates).toBe(5);
    expect(plan.unsupportedConcepts).toBe(15);
  });
});
