import { describe, expect, it } from "vitest";
import { buildDeskCompanyFilings, buildDeskLatestFilings, calendarRowsFromCache, type CachedFilingEntry, type CalendarFilingRow } from "./desk-company";

const calendar: CalendarFilingRow[] = [
  { cik: 1, accessionNo: "0000000001-26-000010", form: "10-Q", filingDate: "2026-10-30", reportDate: "2026-09-30", acceptedEt: "2026-10-30T16:05:00", items: null, isEarningsRelease: false, primaryDoc: "q.htm", cachedFiles: [] },
  { cik: 1, accessionNo: "0000000001-26-000011", form: "8-K", filingDate: "2026-11-10", reportDate: "2026-11-10", acceptedEt: "2026-11-10T08:01:00", items: "5.02", isEarningsRelease: false, primaryDoc: "k.htm", cachedFiles: [] },
];
const cached: CachedFilingEntry[] = [
  // already in the calendar
  { accessionNo: "0000000001-26-000011", form: "8-K", filingDate: "2026-11-10", reportDate: "2026-11-10", primaryDoc: "k.htm" },
  // filed on the calendar's last day after the calendar was built
  { accessionNo: "0000000001-26-000012", form: "8-K", filingDate: "2026-11-10", reportDate: "2026-11-10", primaryDoc: "k2.htm", acceptedEt: "2026-11-10T17:20:00", items: "8.01" },
  // an earnings release filed later
  { accessionNo: "0000000001-26-000013", form: "8-K", filingDate: "2026-11-19", reportDate: "2026-11-19", primaryDoc: "er.htm", acceptedEt: "2026-11-19T16:31:05", items: "2.02, 9.01" },
  // written before the cache kept items and times
  { accessionNo: "0000000001-26-000014", form: "8-K", filingDate: "2026-11-20", reportDate: "", primaryDoc: "old.htm" },
  // not a report the page lists
  { accessionNo: "0000000001-26-000015", form: "SCHEDULE 13G/A", filingDate: "2026-11-16", reportDate: "", primaryDoc: "g.htm" },
  // older than the calendar's last day and missing from it: the calendar is the only source there
  { accessionNo: "0000000001-26-000009", form: "8-K", filingDate: "2026-10-01", reportDate: "2026-10-01", primaryDoc: "x.htm" },
  { accessionNo: "0000000001-26-000016", form: "10-K/A", filingDate: "2026-11-23", reportDate: "2025-12-31", primaryDoc: "ka.htm", acceptedEt: null, items: null },
];

describe("filings beyond the release calendar", () => {
  it("adds only reports the calendar lacks, filed on or after its last day", () => {
    const rows = calendarRowsFromCache({ cik: 1, calendar, cached, calendarAsOf: "2026-11-10" });
    expect(rows.map((row) => row.accessionNo)).toEqual(["0000000001-26-000012", "0000000001-26-000013", "0000000001-26-000014", "0000000001-26-000016"]);
  });

  it("marks an earnings release by item 2.02 and never without items", () => {
    const rows = calendarRowsFromCache({ cik: 1, calendar, cached, calendarAsOf: "2026-11-10" });
    expect(rows.map((row) => row.isEarningsRelease)).toEqual([false, true, false, false]);
    expect(rows[1]).toMatchObject({ acceptedEt: "2026-11-19T16:31:05", items: "2.02, 9.01", reportDate: "2026-11-19" });
    expect(rows[2]).toMatchObject({ acceptedEt: null, items: null, reportDate: null });
  });

  it("does not repeat a filing the cache lists twice", () => {
    const rows = calendarRowsFromCache({ cik: 1, calendar: [], cached: [cached[2], cached[2]], calendarAsOf: "2026-11-10" });
    expect(rows).toHaveLength(1);
  });

  it("feeds the page's list: newest first, to the newest filing date", () => {
    const extra = calendarRowsFromCache({ cik: 1, calendar, cached, calendarAsOf: "2026-11-10" });
    const page = buildDeskCompanyFilings({ cik: 1, ticker: "TEST", rows: [...calendar, ...extra], asOf: "2026-11-23", builtAt: "2026-11-24T10:00:00.000Z" });
    expect(page?.filings.map((filing) => filing.filed)).toEqual(["2026-11-23", "2026-11-20", "2026-11-19", "2026-11-10", "2026-11-10", "2026-10-30"]);
    expect(page?.filings.find((filing) => filing.accession === "0000000001-26-000013")).toMatchObject({ earnings: true, items: ["2.02", "9.01"] });
    expect(page?.asOf).toBe("2026-11-23");
  });
});

describe("the newest filings across companies", () => {
  const row = (cik: number, accessionNo: string, filingDate: string, acceptedEt: string | null, items: string | null = null): CalendarFilingRow =>
    ({ cik, accessionNo, form: "8-K", filingDate, reportDate: filingDate, acceptedEt, items, isEarningsRelease: items === "2.02", primaryDoc: "d.htm", cachedFiles: [] });
  const built = (cik: number, ticker: string, rows: CalendarFilingRow[]) => buildDeskCompanyFilings({ cik, ticker, rows, asOf: "2026-11-23", builtAt: "2026-11-24T10:00:00.000Z" })!;

  it("lists the last days of every company, newest first, by acceptance time within a day", () => {
    const one = built(1, "ONE", [row(1, "0000000001-26-000001", "2026-11-20", "2026-11-20T08:00:00"), row(1, "0000000001-26-000002", "2026-08-01", "2026-08-01T08:00:00")]);
    const two = built(2, "TWO", [row(2, "0000000002-26-000001", "2026-11-23", null), row(2, "0000000002-26-000002", "2026-11-20", "2026-11-20T16:10:00", "2.02")]);
    const latest = buildDeskLatestFilings({ companies: [one, two], asOf: "2026-11-23", builtAt: "2026-11-24T10:00:00.000Z" });
    expect(latest.filings.map((filing) => `${filing.ticker} ${filing.filed}`)).toEqual(["TWO 2026-11-23", "TWO 2026-11-20", "ONE 2026-11-20"]);
    expect(latest.filings[1]).toMatchObject({ earnings: true, accession: "0000000002-26-000002", cik: 2 });
    expect(latest).toMatchObject({ asOf: "2026-11-23", days: 90 });
  });

  it("reaches back only as far as asked", () => {
    const one = built(1, "ONE", [row(1, "0000000001-26-000001", "2026-11-20", null), row(1, "0000000001-26-000002", "2026-11-01", null)]);
    expect(buildDeskLatestFilings({ companies: [one], asOf: "2026-11-23", builtAt: "x", days: 7 }).filings).toHaveLength(1);
  });
});
