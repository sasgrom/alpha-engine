import { describe, expect, it } from "vitest";
import { buildExpectationsReport, type ExpectationResultForReport } from "./expectations-report";
import type { ExpectationStatement } from "./expectations";

const statement: ExpectationStatement = {
  kind: "guidance", metricRaw: "Revenue", metric: "revenue", scopeRaw: "Consolidated", periodRaw: "Q4 2026", comparisonRaw: null,
  qualifier: "range", valueLow: 240, valueHigh: 247, valuePoint: null, tolerance: null, toleranceUnit: null, valueText: null,
  unit: "usd_billions", basis: "reported", currencyBasis: "reported", revision: "initial", previousLow: null, previousHigh: null,
  previousPoint: null, previousGuidanceDateRaw: null, assumptionRaw: null, sourceSection: "Guidance", evidence: "Revenue is expected to be $240 to $247 billion",
};
const result = (overrides: Partial<ExpectationResultForReport> = {}): ExpectationResultForReport => ({
  cik: 1, ticker: "AAA", accessionNo: "0000000-26-000001", form: "8-K", filingDate: "2026-10-01", sourceFile: "cache/file.htm",
  status: "extracted", guidanceStatus: "found", statements: [statement], rejectedEvidence: 0, usage: { promptTokens: 100, evalCount: 20 }, ...overrides,
});

describe("reviewed expectations report", () => {
  it("builds honest waiting and partial coverage without raw responses", () => {
    const waiting = buildExpectationsReport([{ cik: 1, ticker: "AAA" }], [], "2026-10-30T00:00:00Z", "latest filings");
    expect(waiting.status).toBe("waiting");
    expect(waiting.coverage.companiesWithResults).toBe(0);
    const report = buildExpectationsReport([{ cik: 1, ticker: "AAA" }, { cik: 2, ticker: "BBB" }], [result()], "2026-10-30T00:00:00Z", "latest filings");
    expect(report.status).toBe("partial");
    expect(report.coverage.companiesExpected).toBe(2);
    expect(report.coverage.companiesWithResults).toBe(1);
    expect(report.coverage.statements).toBe(1);
    expect(report.statements[0].sourceUrl).toContain("edgar/data/1/000000026000001");
    expect(JSON.stringify(report)).not.toContain("rawResponse");
  });

  it("never marks a report reviewed without a passing independent benchmark", () => {
    expect(() => buildExpectationsReport([{ cik: 1, ticker: "AAA" }], [result()], "2026-10-30T00:00:00Z", "latest", null, true)).toThrow("passing independent benchmark");
    const reviewed = buildExpectationsReport([{ cik: 1, ticker: "AAA" }], [result()], "2026-10-30T00:00:00Z", "latest", { pass: true, recall: 1, issueCount: 0 }, true);
    expect(reviewed.status).toBe("reviewed");
  });
});
