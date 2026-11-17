import { describe, expect, it } from "vitest";
import { buildFlashExtractSummary, flashQuarterRecord } from "./flash-extract";
import type { GradeRecord, ProcessReleaseResult, ReleaseContext, ValueRecord } from "./flash-pipeline";

const release: ReleaseContext = { cik: 1, ticker: "ONE", accessionNo: "0000000001-24-000001", filingDate: "2024-04-15", acceptedEt: "2024-04-15T16:00:00", fiscalPeriodEnd: "2024-03-31", periodicAccession: "0000000001-24-000002", periodicForm: "10-Q" };

function value(overrides: Partial<ValueRecord>): ValueRecord {
  return {
    valueId: "value", cik: 1, ticker: "ONE", releaseAccession: release.accessionNo, acceptedEt: release.acceptedEt,
    statement: "income", rowLabel: "Revenue", headingPath: [], matchedConcepts: ["Revenues"], months: 3, factMonths: 3,
    instant: false, periodEnd: "2024-03-31", current: true, value: 120, rawPrinted: "120", unitMultiplier: 1,
    perShare: false, shares: false, percent: false, signNote: null, howNamed: "answer_key",
    source: { file: "1/release.htm", sha256: "a".repeat(64), tableIndex: 1, rowIndex: 4, columnIndex: 1, sourceCol: 1 }, evidence: [], ...overrides,
  };
}

function result(values: ValueRecord[], gradeStatuses: Record<string, GradeRecord["status"]> = {}): ProcessReleaseResult {
  return {
    statements: [], values, residual: [],
    grades: Object.entries(gradeStatuses).map(([valueId, status]) => ({ valueId, status } as GradeRecord)),
    coverage: {
      income: true, balance: false, cashflow: false, currentPeriodEnd: "2024-03-31", expectedPeriodEnd: "2024-03-31",
      periodMatch: true, periodDeltaDays: 0, exhibits: 1, tables: 1, candidates: 1, dataRows: 1, namedRows: 1,
      values: values.length, grades: Object.keys(gradeStatuses).length, answerKeyFacts: 0, pitViolations: 0,
    }, errors: [],
  };
}

describe("release-quarter extract", () => {
  it("pairs three-month current and year-ago values on the same printed row", () => {
    const current = value({ valueId: "revenue-current", rawPrinted: "$120" });
    const yearAgo = value({ valueId: "revenue-prior", current: false, periodEnd: "2023-03-31", value: 100, rawPrinted: "$100", source: { ...current.source, columnIndex: 2, sourceCol: 2 } });
    const annual = value({ valueId: "annual", months: 12, factMonths: 12, value: 999, source: { ...current.source, tableIndex: 2 } });
    const netIncome = value({ valueId: "net-current", matchedConcepts: ["NetIncomeLoss"], value: 8, source: { ...current.source, rowIndex: 5 } });
    const processed = result([annual, current, yearAgo, netIncome], { "revenue-current": "match", "net-current": "mismatch" });
    const row = flashQuarterRecord(release, processed);
    expect(row).toMatchObject({
      cik: 1, ticker: "ONE", accession: release.accessionNo, fiscalPeriodEnd: "2024-03-31", periodEnd: "2024-03-31",
      revenue: 120, revenueYearAgo: 100, revenueConcept: "Revenues", revenueYearAgoConcept: "Revenues",
      revenueGrade: "match", revenueYearAgoGrade: null, netIncome: 8, netIncomeYearAgo: null, netIncomeGrade: "mismatch",
      operatingIncome: null,
      revenueEvidence: { rawPrinted: "$120", yearAgoRawPrinted: "$100", source: current.source, yearAgoSource: yearAgo.source },
    });
  });

  it("does not substitute an annual value or a fact for a missing printed quarter", () => {
    const annual = value({ valueId: "annual", months: 12, factMonths: 12, value: 999 });
    const row = flashQuarterRecord(release, result([annual], { annual: "match" }));
    expect(row.revenue).toBeNull();
    expect(row.revenueYearAgo).toBeNull();
    expect(row.revenueConcept).toBeNull();
    expect(row.revenueGrade).toBeNull();
  });

  it("summarizes release and revenue-grade coverage by year, sector and company", () => {
    const current = value({ valueId: "revenue-current" });
    const yearAgo = value({ valueId: "revenue-prior", current: false, periodEnd: "2023-03-31", value: 100 });
    const first = result([current, yearAgo], { "revenue-current": "match" });
    const secondRelease = { ...release, cik: 2, ticker: "TWO", accessionNo: "0000000002-24-000001" };
    const second = result([]);
    const summary = buildFlashExtractSummary({ releases: [release, secondRelease], readResult: (item) => item.cik === 1 ? first : second, sectorByCik: new Map([[1, "Technology"], [2, "Finance"]]) });
    expect(summary.overall).toMatchObject({ releases: 2, revenue: 1, revenueYearAgo: 1, revenueShare: 0.5, revenueGradable: 1, revenueMatches: 1, revenueGradeMatchShare: 1, revenueMatchReleaseShare: 0.5 });
    expect(summary.byYear["2024"].releases).toBe(2);
    expect(summary.bySector.Technology.revenueShare).toBe(1);
    expect(summary.bySector.Finance.revenueShare).toBe(0);
    expect(summary.byCompany.ONE.revenueGradeMatchShare).toBe(1);
  });
});
