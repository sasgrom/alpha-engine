import { describe, expect, it } from "vitest";
import { analyzeEdgarGaps } from "./edgar-gap-analysis";
import type { FundamentalIntegrityReport, IntegrityIssue } from "./fundamental-integrity";

const issue = (type: IntegrityIssue["type"], periodEnd: string | undefined, message: string, severity: "error" | "warning" = "error"): IntegrityIssue => ({ severity, type, cik: 1, concept: "Assets", periodEnd, message });
const source: FundamentalIntegrityReport = {
  schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", universeSha256: "abc", status: "fail",
  summary: { ciks: 1, facts: 0, series: 0, factors: 0, errors: 0, warnings: 0, duplicates: 0, continuityGaps: 0, availabilityInversions: 0, coverageGaps: 0, omittedIssues: 0 },
  issues: [
    issue("continuity_gap", "1999-09-30", "1 missing quarters in expected grid: 1999Q4"),
    issue("continuity_gap", "2020-03-31", "2 missing quarters in expected grid: 2020Q1, 2020Q2"),
    issue("continuity_gap", "2020-03-31", "2 missing quarters in canonical grid: 2020Q1, 2020Q2"),
    issue("revision_outlier", "2024-03-31", "Large revision: 100 → -200", "warning"),
    issue("unit_change", undefined, "Unit changes across history: USD, shares", "warning"),
  ],
};

describe("EDGAR gap analysis", () => {
  it("deduplicates missing quarters across fact and series layers and respects the 2000 cutoff", () => {
    const result = analyzeEdgarGaps(source, "2026-10-31T01:00:00Z");
    expect(result.summary.excludedPre2000).toBe(1);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].missingQuarters).toEqual(["2020Q1", "2020Q2"]);
    expect(result.gaps[0].firstMissingPeriod).toBe("2020Q1");
    expect(result.gaps[0].lastMissingPeriod).toBe("2020Q2");
    expect(result.summary.continuityQuarters).toBe(2);
    expect(result.byEra.find((row) => row.era === "2020-2024")?.errors).toBe(2);
  });

  it("keeps display-cap omissions explicit and recommends refresh only for recent gaps", () => {
    const result = analyzeEdgarGaps(source, "2026-10-31T01:00:00Z", "2000-01-01", 1);
    expect(result.omittedGaps).toBe(0);
    expect(result.gaps[0].recommendedAction).toContain("Refresh EDGAR");
  });
});
