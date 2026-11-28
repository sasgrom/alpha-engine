import { describe, expect, it } from "vitest";
import { buildDeskShortInterest, finraSymbol, parseFinraShortInterest, r1000FinraCompanies, shareCountAt, shareCountsFromStatements, shortInterestCandidates } from "./finra-short-interest";

const HEADER = `"accountingYearMonthNumber"|"symbolCode"|"issueName"|"issuerServicesGroupExchangeCode"|"marketClassCode"|"currentShortPositionQuantity"|"previousShortPositionQuantity"|"stockSplitFlag"|"averageDailyVolumeQuantity"|"daysToCoverQuantity"|"revisionFlag"|"changePercent"|"changePreviousNumber"|"settlementDate"`;
const line = (symbol: string, shares: string, volume: string, days: string, date: string) => `"${date.replaceAll("-", "")}"|"${symbol}"|"Name"|"A"|"NYSE"|"${shares}"|"1"||"${volume}"|"${days}"||"0.00"|"0"|"${date}"`;

describe("the dates FINRA publishes for", () => {
  it("lists mid-month and month-end with the weekdays just before, newest first", () => {
    const groups = shortInterestCandidates("2026-10-01", "2026-11-24");
    // 15 Nov 2026 is a Sunday: the settlement is Friday the 13th
    expect(groups[0]).toEqual(["2026-11-13", "2026-11-12"]);
    // 31 Oct 2026 is a Saturday: Friday the 30th
    expect(groups[1]).toEqual(["2026-10-30", "2026-10-29", "2026-10-28"]);
    expect(groups[2]).toEqual(["2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]);
    expect(groups).toHaveLength(3);
  });

  it("leaves out a settlement after the last day asked for", () => {
    expect(shortInterestCandidates("2026-11-01", "2026-11-14")).toEqual([]);
  });

  it("crosses a year end", () => {
    const groups = shortInterestCandidates("2026-12-20", "2027-01-20");
    expect(groups.map((group) => group[0])).toEqual(["2027-01-15", "2026-12-31"]);
  });
});

describe("a FINRA short interest file", () => {
  it("reads symbol, shares, volume and days to cover", () => {
    const rows = parseFinraShortInterest([HEADER, line("A", "4892390", "2185306", "2.24", "2026-10-30"), line("BRKB", "15232424", "4459554", "3.42", "2026-10-30")].join("\n"));
    expect(rows).toEqual([
      { symbol: "A", settlementDate: "2026-10-30", shares: 4892390, averageDailyVolume: 2185306, daysToCover: 2.24 },
      { symbol: "BRKB", settlementDate: "2026-10-30", shares: 15232424, averageDailyVolume: 4459554, daysToCover: 3.42 },
    ]);
  });

  it("gives no days to cover where FINRA had no volume", () => {
    const rows = parseFinraShortInterest([HEADER, line("BFAAF", "77119", "0", "999.99", "2026-10-30")].join("\r\n"));
    expect(rows[0]).toMatchObject({ shares: 77119, averageDailyVolume: 0, daysToCover: null });
  });

  it("refuses a file with a missing column, an unreadable line or two settlement dates", () => {
    expect(() => parseFinraShortInterest(`"symbolCode"|"settlementDate"\n"A"|"2026-10-30"`)).toThrow(/no currentShortPositionQuantity/);
    expect(() => parseFinraShortInterest([HEADER, line("A", "", "1", "1", "2026-10-30")].join("\n"))).toThrow(/Unreadable/);
    expect(() => parseFinraShortInterest([HEADER, line("A", "1", "1", "1", "2026-10-30"), line("B", "1", "1", "1", "2026-10-15")].join("\n"))).toThrow(/one settlement date/);
    expect(() => parseFinraShortInterest(HEADER)).toThrow(/one settlement date/);
  });
});

describe("the desk's short interest history", () => {
  const october = parseFinraShortInterest([HEADER, line("A", "100", "50", "2.00", "2026-10-30"), line("BRKB", "300", "100", "3.00", "2026-10-30"), line("ZZZ", "9", "1", "9.00", "2026-10-30")].join("\n"));
  const midOctober = parseFinraShortInterest([HEADER, line("A", "80", "40", "2.00", "2026-10-15")].join("\n"));
  const companies = [{ cik: 1, ticker: "A" }, { cik: 2, ticker: "BRK-B" }, { cik: 3, ticker: "NONE" }];

  it("writes a share class as FINRA does", () => {
    expect(finraSymbol("BRK-B")).toBe("BRKB");
    expect(finraSymbol("bf.b")).toBe("BFB");
  });

  it("gives each company its readings newest first and nothing for a company FINRA does not list", () => {
    const file = buildDeskShortInterest({ files: [midOctober, october], companies, builtAt: "2026-11-24T10:00:00.000Z" });
    expect(file).toMatchObject({ asOf: "2026-10-30", settlements: ["2026-10-30", "2026-10-15"] });
    expect(file.companies["1"].map((point) => point.date)).toEqual(["2026-10-30", "2026-10-15"]);
    expect(file.companies["2"]).toEqual([{ date: "2026-10-30", shares: 300, averageDailyVolume: 100, daysToCover: 3 }]);
    expect(file.companies["3"]).toBeUndefined();
  });

  it("gives a symbol two companies share to neither, and names it", () => {
    const file = buildDeskShortInterest({ files: [october], companies: [{ cik: 1, ticker: "BRK-B" }, { cik: 2, ticker: "BRK.B" }, { cik: 3, ticker: "A" }], builtAt: "x" });
    expect(file.ambiguous).toEqual(["BRKB"]);
    expect(Object.keys(file.companies)).toEqual(["3"]);
  });

  it("divides shares short by the share count filed by the settlement date, all classes, never a later one", () => {
    const statements = {
      quarters: [{ end: "2026-03-31" }, { end: "2026-06-30" }, { end: "2026-09-30" }],
      statements: {
        income: [{ code: "shareswa", cells: [{ value: 990, filed: "2026-05-01" }, { value: 995, filed: "2026-08-01" }, { value: 1000, filed: "2026-11-01" }] }],
        balance: [{ code: "sharesBasic", cells: [null, { value: 1000, filed: "2026-08-01" }, { value: 2000, filed: "2026-11-01" }] }],
      },
    };
    const counts = shareCountsFromStatements(statements);
    expect(counts.map((count) => [count.end, count.kind])).toEqual([["2026-03-31", "weighted average"], ["2026-06-30", "outstanding"], ["2026-09-30", "outstanding"]]);
    expect(shareCountAt(counts, "2026-10-30")).toMatchObject({ end: "2026-06-30", shares: 1000 });
    expect(shareCountAt(counts, "2026-07-15")).toMatchObject({ end: "2026-03-31", shares: 990 });
    expect(shareCountAt(counts, "2027-06-30")).toBeNull();                      // newest filed more than 200 days before
    const file = buildDeskShortInterest({ files: [october], companies: [{ cik: 1, ticker: "A" }, { cik: 1652044, ticker: "GOOGL" }], builtAt: "x", shareCounts: new Map([[1, counts]]) });
    expect(file.companies["1"][0]).toMatchObject({ shareOfShares: 0.1, shareCount: { end: "2026-06-30", kind: "outstanding" } });
    const several = buildDeskShortInterest({ files: [parseFinraShortInterest([HEADER, line("GOOGL", "100", "50", "2.00", "2026-10-30")].join("\n"))], companies: [{ cik: 1652044, ticker: "GOOGL" }], builtAt: "x", shareCounts: new Map([[1652044, counts]]) });
    expect(several.companies["1652044"][0]).toMatchObject({ shareOfShares: null, shareCount: null });
  });

  it("refuses a settlement read twice and no file at all", () => {
    expect(() => buildDeskShortInterest({ files: [october, october], companies, builtAt: "x" })).toThrow(/read twice/);
    expect(() => buildDeskShortInterest({ files: [], companies, builtAt: "x" })).toThrow(/No FINRA/);
  });

  it("keeps every r1000 common-share class", () => {
    expect(r1000FinraCompanies([
      { cik: 1, ticker: "AAA", tickers: ["AAA", "AAAB"] },
      { cik: 2, ticker: "BBB" },
    ])).toEqual([{ cik: 1, ticker: "AAA" }, { cik: 1, ticker: "AAAB" }, { cik: 2, ticker: "BBB" }]);
  });
});
