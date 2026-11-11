import { describe, expect, it } from "vitest";
import { acceptanceChecks, acceptanceEt, acceptanceUtc, buildQuarters, earningsFlag, newYorkToUtc, type CalendarFiling } from "./event-calendar";

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
  });
});
