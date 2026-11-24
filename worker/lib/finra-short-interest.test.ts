import { describe, expect, it } from "vitest";
import { buildDeskShortInterest, finraSymbol, parseFinraShortInterest, shortInterestCandidates } from "./finra-short-interest";

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

  it("refuses a settlement read twice and no file at all", () => {
    expect(() => buildDeskShortInterest({ files: [october, october], companies, builtAt: "x" })).toThrow(/read twice/);
    expect(() => buildDeskShortInterest({ files: [], companies, builtAt: "x" })).toThrow(/No FINRA/);
  });
});
