import { describe, expect, it } from "vitest";
import { acceptanceChecks, acceptanceEt, acceptanceUtc, buildQuarters, earningsFlag, newYorkToUtc, type CalendarFiling, type CalendarQuarter } from "./event-calendar";

const filing = (overrides: Partial<CalendarFiling>): CalendarFiling => ({
  cik: 1,
  ticker: "AAA",
  accessionNo: "0000000001-26-000001",
  form: "10-Q",
  filingDate: "2026-01-07",
  reportDate: "2025-12-31",
  acceptedEt: "2026-01-07T10:00:00",
  acceptedUtc: "2026-01-07T15:00:00.000Z",
  acceptedSource: "sec_submissions",
  items: null,
  itemsSource: "unavailable",
  isEarningsRelease: false,
  earningsFlagBasis: "none",
  primaryDoc: null,
  cachedFiles: [],
  ...overrides,
});

describe("event calendar acceptance metadata", () => {
  it("converts New York wall time to UTC across DST regimes", () => {
    expect(newYorkToUtc("2026-07-01T12:00:00")).toBe("2026-07-01T16:00:00.000Z");
    expect(newYorkToUtc("2026-01-01T12:00:00")).toBe("2026-01-01T17:00:00.000Z");
    expect(acceptanceEt("20260701120000")).toBe("2026-07-01T12:00:00");
    expect(acceptanceEt("2015-07-06T20:43:40.000Z")).toBe("2015-07-06T16:43:40");
    expect(acceptanceUtc("2015-07-06T20:43:40.000Z", "2015-07-06T16:43:40")).toBe("2015-07-06T20:43:40.000Z");
  });

  it("uses item 2.02, item 12 and the text rule by date", () => {
    expect(earningsFlag("8-K", "2.02,9.01", "2026-01-01", null)).toEqual({ isEarningsRelease: true, earningsFlagBasis: "item_2.02" });
    expect(earningsFlag("8-K", "12", "2004-01-01", null)).toEqual({ isEarningsRelease: true, earningsFlagBasis: "item_12" });
    expect(earningsFlag("8-K", null, "2001-01-01", "Results of Operations and Financial Condition")).toEqual({ isEarningsRelease: true, earningsFlagBasis: "text_rule" });
    expect(earningsFlag("8-K", null, "2001-01-01", null)).toEqual({ isEarningsRelease: null, earningsFlagBasis: "none" });
  });
});

describe("quarter timeline", () => {
  it("pairs the earliest earnings release and counts sessions between publications", () => {
    const rows = [
      filing({ accessionNo: "0000000001-26-000001", acceptedEt: "2026-01-07T10:00:00", acceptedUtc: "2026-01-07T15:00:00.000Z" }),
      filing({ accessionNo: "0000000001-26-000002", form: "8-K", filingDate: "2026-01-05", acceptedEt: "2026-01-05T09:00:00", acceptedUtc: "2026-01-05T14:00:00.000Z", isEarningsRelease: true, earningsFlagBasis: "item_2.02" }),
      filing({ accessionNo: "0000000001-26-000003", reportDate: "2026-03-31", acceptedEt: "2026-04-02T10:00:00", acceptedUtc: "2026-04-02T14:00:00.000Z" }),
    ];
    const quarters = buildQuarters(rows, ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-11", "2026-01-12", "2026-01-20"]);
    expect(quarters).toHaveLength(2);
    expect(quarters[0]).toMatchObject({ earningsAccession: "0000000001-26-000002", pairingBasis: "earnings_8k", nextFirstPublicationEt: "2026-04-02T10:00:00", windowSessions: 6 });
    expect(quarters[1].pairingBasis).toBe("periodic_only");
    expect(quarters[1].nextFirstPublicationEt).toBeNull();
    const checks = acceptanceChecks(rows, quarters);
    expect(checks.quarters.lagDays.median).toBe(2);
    expect(checks.quarters.lagDays.negative).toBe(0);
    expect(quarters[0].earningsFilings).toEqual([{ accessionNo: "0000000001-26-000002", acceptedEt: "2026-01-05T09:00:00" }]);
  });

  it("uses originals in fiscal order, links amendments and retains every earnings filing", () => {
    const rows = [
      filing({ accessionNo: "q3-original", reportDate: "2026-09-30", acceptedEt: "2026-11-06T10:00:00", acceptedUtc: "2026-11-06T15:00:00.000Z" }),
      filing({ accessionNo: "q2-earnings-late", form: "8-K", acceptedEt: "2026-08-05T09:00:00", acceptedUtc: "2026-08-05T13:00:00.000Z", isEarningsRelease: true, earningsFlagBasis: "item_2.02" }),
      filing({ accessionNo: "q1-amendment", form: "10-Q/A", reportDate: "2026-03-31", acceptedEt: "2026-05-12T10:00:00", acceptedUtc: "2026-05-12T14:00:00.000Z" }),
      filing({ accessionNo: "q2-original", reportDate: "2026-06-30", acceptedEt: "2026-08-07T10:00:00", acceptedUtc: "2026-08-07T14:00:00.000Z" }),
      filing({ accessionNo: "q1-original", reportDate: "2026-03-31", acceptedEt: "2026-05-07T10:00:00", acceptedUtc: "2026-05-07T14:00:00.000Z" }),
      filing({ accessionNo: "q3-earnings", form: "8-K", acceptedEt: "2026-11-01T09:00:00", acceptedUtc: "2026-11-01T14:00:00.000Z", isEarningsRelease: true, earningsFlagBasis: "item_2.02" }),
      filing({ accessionNo: "q2-amendment", form: "10-Q/A", reportDate: "2026-06-30", acceptedEt: "2026-08-12T10:00:00", acceptedUtc: "2026-08-12T14:00:00.000Z" }),
      filing({ accessionNo: "q2-earnings-early", form: "8-K", acceptedEt: "2026-08-01T09:00:00", acceptedUtc: "2026-08-01T13:00:00.000Z", isEarningsRelease: true, earningsFlagBasis: "item_2.02" }),
      filing({ accessionNo: "q1-earnings", form: "8-K", acceptedEt: "2026-05-01T09:00:00", acceptedUtc: "2026-05-01T13:00:00.000Z", isEarningsRelease: true, earningsFlagBasis: "item_2.02" }),
      filing({ accessionNo: "amendment-only-period", form: "10-Q/A", reportDate: "2025-12-31", acceptedEt: "2026-01-15T10:00:00", acceptedUtc: "2026-01-15T15:00:00.000Z" }),
    ];
    const quarters = buildQuarters(rows, ["2026-05-01", "2026-05-02", "2026-07-31", "2026-08-01", "2026-08-02", "2026-10-30", "2026-11-01"]);
    expect(quarters.map((row) => row.periodicAccession)).toEqual(["q1-original", "q2-original", "q3-original"]);
    expect(quarters[0]).toMatchObject({ amendmentAccessions: ["q1-amendment"], nextFirstPublicationEt: "2026-08-01T09:00:00", windowSessions: 2 });
    expect(quarters[1]).toMatchObject({
      earningsAccession: "q2-earnings-early",
      earningsFilings: [
        { accessionNo: "q2-earnings-early", acceptedEt: "2026-08-01T09:00:00" },
        { accessionNo: "q2-earnings-late", acceptedEt: "2026-08-05T09:00:00" },
      ],
    });
    expect(quarters[1]).not.toHaveProperty("otherEarningsAccessions");
    expect(quarters.every((row) => row.nextFirstPublicationEt === null || row.firstPublicationEt === null || row.nextFirstPublicationEt > row.firstPublicationEt)).toBe(true);
    const checks = acceptanceChecks(rows, quarters);
    expect(checks.quarters).toMatchObject({ originalPeriodicRows: 3, uniqueCompanyPeriods: 3, duplicateCompanyPeriods: 0, originalsSince2005: 3, rowsSince2005: 3, missingOriginalAccessionsSince2005: [], chosenReleaseIsFirst: true });
    expect(checks.periodicAmendments).toEqual({ filings: 3, linkedToQuarters: 2, amendmentOnlyFilings: 1, amendmentOnlyPeriods: ["AAA/2025-12-31"] });
  });

  it("rejects a next quarter whose first publication is not strictly later", () => {
    const rows = [
      filing({ accessionNo: "q1", reportDate: "2026-03-31", acceptedEt: "2026-05-07T10:00:00", acceptedUtc: "2026-05-07T14:00:00.000Z" }),
      filing({ accessionNo: "q2", reportDate: "2026-06-30", acceptedEt: "2026-05-07T10:00:00", acceptedUtc: "2026-05-07T14:00:00.000Z" }),
    ];
    expect(() => buildQuarters(rows, [])).toThrow(/strictly later/);
  });

  it("uses at-least session thresholds and first-to-next calendar days", () => {
    const base: CalendarQuarter = {
      cik: 1,
      ticker: "AAA",
      fiscalPeriodEnd: "2025-12-31",
      periodicForm: "10-Q",
      periodicAccession: "p0",
      periodicAcceptedEt: "2026-01-01T10:00:00",
      earningsAccession: null,
      earningsAcceptedEt: null,
      firstPublicationEt: "2026-01-01T10:00:00",
      pairingBasis: "periodic_only",
      amendmentAccessions: [],
      earningsFilings: [],
      nextFirstPublicationEt: "2026-01-15T10:00:00",
      windowSessions: 19,
    };
    const quarters: CalendarQuarter[] = [
      base,
      { ...base, fiscalPeriodEnd: "2026-03-31", periodicAccession: "p1", nextFirstPublicationEt: "2026-01-21T10:00:00", windowSessions: 20 },
      { ...base, fiscalPeriodEnd: "2026-06-30", periodicAccession: "p2", nextFirstPublicationEt: "2026-02-01T10:00:00", windowSessions: 30 },
      { ...base, fiscalPeriodEnd: "2026-09-30", periodicAccession: "p3", nextFirstPublicationEt: "2026-05-11T10:00:00", windowSessions: 45 },
      { ...base, fiscalPeriodEnd: "2026-12-31", periodicAccession: "p4", nextFirstPublicationEt: null, windowSessions: null },
    ];
    const checks = acceptanceChecks([], quarters);
    expect(checks.windowSessions).toMatchObject({ count: 4, median: 20, p05: 19, p95: 30, share20: 0.75, share30: 0.5, share45: 0.25 });
    expect(checks.windowSessionsFrom2009_06.count).toBe(4);
    expect(checks.quarters.windowsUnder20.map((row) => row.calendarDays)).toEqual([14]);
    expect(checks.quarters.windowsOver120.map((row) => row.calendarDays)).toEqual([130]);
  });
});
