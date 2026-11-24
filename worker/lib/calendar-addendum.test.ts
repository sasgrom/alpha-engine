import { describe, expect, it } from "vitest";
import { buildCompanyAddendum, calendarFilingFromCache, nextPeriodEnd, periodEndAccuracy, type CachedManifestFiling } from "./calendar-addendum";
import { newYorkToUtc, type CalendarFiling } from "./event-calendar";

const company = { cik: 1, ticker: "ONE" };
const pinned = (accessionNo: string, form: string, filingDate: string, reportDate: string | null, acceptedEt: string, items: string | null = null): CalendarFiling => ({
  cik: 1, ticker: "ONE", accessionNo, form, filingDate, reportDate, primaryDoc: "d.htm", acceptedEt, acceptedUtc: newYorkToUtc(acceptedEt), acceptedSource: "sec_submissions",
  items, itemsSource: items ? "sec_submissions" : "unavailable", isEarningsRelease: items === "2.02,9.01", earningsFlagBasis: items ? "item_2.02" : "none", cachedFiles: [],
});
const pinnedFilings = [
  pinned("0000000001-26-000001", "8-K", "2026-07-30", "2026-07-30", "2026-07-30T16:05:00", "2.02,9.01"),
  pinned("0000000001-26-000002", "10-Q", "2026-07-31", "2026-06-30", "2026-07-31T08:00:00"),
];
const cache = (accessionNo: string, form: string, filingDate: string, acceptedEt: string | undefined, items?: string, reportDate = ""): CachedManifestFiling => ({ accessionNo, form, filingDate, reportDate, primaryDoc: "n.htm", acceptedEt, items });

describe("a cached filing in the calendar's shape", () => {
  it("carries its acceptance time in both zones and the earnings flag by item 2.02", () => {
    const row = calendarFilingFromCache(company, cache("0000000001-26-000010", "8-K", "2026-11-19", "2026-11-19T16:31:05", "2.02, 9.01", "2026-11-19"))!;
    expect(row).toMatchObject({ acceptedEt: "2026-11-19T16:31:05", acceptedUtc: "2026-11-19T21:31:05.000Z", acceptedSource: "nightly_cache", isEarningsRelease: true, earningsFlagBasis: "item_2.02", reportDate: "2026-11-19" });
  });

  it("does not call an 8-K without items an earnings release, and skips other forms", () => {
    expect(calendarFilingFromCache(company, cache("0000000001-26-000011", "8-K", "2026-11-19", undefined))).toMatchObject({ isEarningsRelease: null, acceptedEt: null, acceptedUtc: null, acceptedSource: "missing", reportDate: null });
    expect(calendarFilingFromCache(company, cache("0000000001-26-000012", "SCHEDULE 13G", "2026-11-19", "2026-11-19T10:00:00"))).toBeNull();
  });
});

describe("the next period end", () => {
  it("moves a month-end period three months and any other period thirteen weeks", () => {
    expect(nextPeriodEnd("2026-06-30")).toBe("2026-09-30");
    expect(nextPeriodEnd("2026-11-30")).toBe("2027-02-28");
    expect(nextPeriodEnd("2026-12-31")).toBe("2027-03-31");
    expect(nextPeriodEnd("2026-06-27")).toBe("2026-09-26");
    expect(nextPeriodEnd("2026-07-26")).toBe("2026-10-25");
  });

  it("is measured on consecutive known quarters only", () => {
    const quarters = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-12-31"].map((fiscalPeriodEnd) => ({ cik: 1, fiscalPeriodEnd }))
      .concat(["2026-03-28", "2026-06-27", "2026-10-03"].map((fiscalPeriodEnd) => ({ cik: 2, fiscalPeriodEnd })));
    // company 1: two consecutive pairs, both exact (the half-year gap is skipped); company 2: one exact, one a week late (a 14-week quarter)
    expect(periodEndAccuracy(quarters)).toEqual({ pairs: 4, exact: 3, withinWeek: 4 });
  });
});

describe("a company's addendum", () => {
  it("is empty when the cache holds nothing after the calendar", () => {
    expect(buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached: [cache("0000000001-26-000002", "10-Q", "2026-07-31", "2026-07-31T08:00:00")], calendarAsOf: "2026-08-01" })).toEqual({ filings: [], quarters: [], unplaced: [] });
  });

  it("pairs a release with its report by the calendar's rule once the report is filed", () => {
    const cached = [
      cache("0000000001-26-000020", "8-K", "2026-10-29", "2026-10-29T16:05:00", "2.02,9.01", "2026-10-29"),
      cache("0000000001-26-000021", "10-Q", "2026-10-30", "2026-10-30T08:00:00", undefined, "2026-09-30"),
    ];
    const addendum = buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached, calendarAsOf: "2026-08-01" });
    expect(addendum.filings).toHaveLength(2);
    expect(addendum.quarters).toHaveLength(1);
    expect(addendum.quarters[0]).toMatchObject({ fiscalPeriodEnd: "2026-09-30", pairingBasis: "earnings_8k", periodicForm: "10-Q", periodicAccession: "0000000001-26-000021", earningsAccession: "0000000001-26-000020" });
    expect(addendum.quarters[0].earningsFilings).toEqual([{ accessionNo: "0000000001-26-000020", acceptedEt: "2026-10-29T16:05:00" }]);
    expect(addendum.unplaced).toEqual([]);
  });

  it("places a release without its report one quarter after the last known period end", () => {
    const cached = [cache("0000000001-26-000020", "8-K", "2026-10-29", "2026-10-29T16:05:00", "2.02,9.01", "2026-10-29"), cache("0000000001-26-000022", "8-K", "2026-11-02", "2026-11-02T09:00:00", "5.02")];
    const addendum = buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached, calendarAsOf: "2026-08-01" });
    expect(addendum.filings).toHaveLength(2);
    expect(addendum.quarters).toEqual([expect.objectContaining({ fiscalPeriodEnd: "2026-09-30", pairingBasis: "earnings_8k_inferred", periodicForm: null, periodicAccession: null, earningsAccession: "0000000001-26-000020" })]);
  });

  it("leaves out a release it cannot place, with the reason", () => {
    const late = buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached: [cache("0000000001-27-000001", "8-K", "2027-03-01", "2027-03-01T16:05:00", "2.02")], calendarAsOf: "2026-08-01" });
    expect(late.quarters).toEqual([]);
    expect(late.unplaced[0].reason).toMatch(/days after the next period end 2026-09-30/);
    const noTime = buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached: [{ accessionNo: "0000000001-26-000030", form: "8-K", filingDate: "2026-10-29", items: "2.02" }], calendarAsOf: "2026-08-01" });
    // without an acceptance time the calendar's rule cannot tell it is a release at all
    expect(noTime.quarters).toEqual([]);
  });

  it("does not take a filing the calendar already lists or one filed before the calendar's last day", () => {
    const cached = [cache("0000000001-26-000001", "8-K", "2026-07-30", "2026-07-30T16:05:00", "2.02,9.01"), cache("0000000001-26-000003", "8-K", "2026-07-15", "2026-07-15T16:05:00", "2.02")];
    expect(buildCompanyAddendum({ company, pinnedFilings, pinnedQuarterEnds: ["2026-06-30"], cached, calendarAsOf: "2026-08-01" }).filings).toEqual([]);
  });
});
