import { describe, expect, it } from "vitest";
import { acceptanceSession, checkCompany, epsAgree, newYorkDate, splitFactorAfter } from "./alpha-vantage-eps-check";

const source = { file: "raw/TEST/2026-11-25.json", sha256: "abc" };
const av = (periodEnd: string, reportedEPS: number, reportedDate: string, reportTime: "pre-market" | "post-market" = "post-market") => ({ periodEnd, reportedEPS, reportedDate, reportTime, source });

describe("Alpha Vantage EPS verification", () => {
  it("uses one cent or one percent and compares original and split-restated bases", () => {
    expect(epsAgree(1.01, 1)).toBe(true);
    expect(epsAgree(100.5, 100)).toBe(true);
    expect(epsAgree(1.02, 1)).toBe(false);
    expect(splitFactorAfter("2020-08-30", [{ date: "2020-08-31", ratio: 4 }, { date: "2021-01-01", ratio: 2 }])).toBe(8);
    const result = checkCompany({
      cik: 1,
      ticker: "TEST",
      alphaVantage: [av("2020-06-30", 0.25, "2020-07-30")],
      adjusted: [{ value: 1, grade: "confirmed", acceptedEt: "2020-07-30T16:05:00", accession: "a1", source: { periodEnd: "2020-06-30", accession: "a1", row: 4 } }],
      gaap: [],
      releases: [{ acceptedEt: "2020-07-30T16:05:00", accessionNo: "a1" }],
      splits: [{ date: "2020-08-31", ratio: 4 }],
    });
    expect(result.comparisons[0]).toMatchObject({ originalMatch: false, restatedMatch: true, bestMatch: true, splitFactor: 4 });
    expect(result.basis.inferred).toBe("restated");
    expect(result.disagreements).toEqual([]);
  });

  it("matches a non-December fiscal year by period end, not fiscal labels", () => {
    const result = checkCompany({
      cik: 2,
      ticker: "FISCAL",
      alphaVantage: [av("2026-10-31", 2.02, "2026-12-01", "pre-market")],
      adjusted: [],
      gaap: [{ value: 2.02, filed: "2026-12-15", source: { periodEnd: "2026-10-28", filed: "2026-12-15", fy: 2027, fq: 1 } }],
      releases: [{ acceptedEt: "2026-12-01T07:15:00", accessionNo: "release" }],
      splits: [],
    });
    expect(result.comparisons[0]).toMatchObject({ series: "gaap", bestMatch: true, matchType: "near", ourPeriodEnd: "2026-10-28", periodDistanceDays: 3 });
    expect(result.exactComparisons).toEqual([]);
    expect(result.dateDisagreements).toEqual([]);
    expect(result.oneSided).toEqual([]);
    expect(result.oneSidedExact).toHaveLength(2);
  });

  it("distinguishes pre-market and post-market releases in New York", () => {
    expect(acceptanceSession("2026-12-01T07:15:00")).toBe("pre-market");
    expect(acceptanceSession("2026-12-01T16:05:00")).toBe("post-market");
    expect(acceptanceSession("2026-12-01T10:00:00")).toBe("market-hours");
    expect(newYorkDate("2026-07-01T03:00:00Z")).toBe("2026-06-30");
    const result = checkCompany({ cik: 3, ticker: "TIME", alphaVantage: [av("2026-09-30", 1, "2026-11-01", "pre-market")], adjusted: [], gaap: [], releases: [{ acceptedEt: "2026-11-01T16:05:00", accessionNo: "late" }], splits: [] });
    expect(result.dateDisagreements[0]).toMatchObject({ dateMatch: true, timeMatch: false });
    const convention = checkCompany({ cik: 3, ticker: "TIME", alphaVantage: [av("2026-09-30", 1, "2026-11-02")], adjusted: [], gaap: [], releases: [{ acceptedEt: "2026-10-30T16:05:00", accessionNo: "friday" }], splits: [], sessions: ["2026-10-30", "2026-11-02"] });
    expect(convention.dateChecks[0]).toMatchObject({ dateOffsetDays: 3, releaseTimeBand: "post-market", nextSessionPostCloseConvention: true });
  });

  it("retains disagreements and quarters present on only one side", () => {
    const result = checkCompany({
      cik: 4,
      ticker: "MISS",
      alphaVantage: [av("2026-09-30", 2, "2026-11-01"), av("2026-03-31", 1, "2026-05-01")],
      adjusted: [{ value: 1, grade: "unchecked", acceptedEt: "2026-11-01T16:00:00", accession: "bad", source: { periodEnd: "2026-09-30" } }],
      gaap: [{ value: 0.5, filed: "2026-06-01", source: { periodEnd: "2026-06-30" } }],
      releases: [],
      splits: [],
    });
    expect(result.disagreements).toHaveLength(1);
    expect(result.dateDisagreements).toHaveLength(2);
    expect(result.oneSided).toEqual([
      { periodEnd: "2026-03-31", side: "alphaVantage", reason: "av-before-ours", ourSources: [], alphaSource: source },
      { periodEnd: "2026-06-30", side: "ours", reason: "true-gap", ourSources: ["gaap"] },
    ]);
  });
});
