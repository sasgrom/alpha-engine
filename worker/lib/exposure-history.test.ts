import { describe, expect, it } from "vitest";
import { aggregateXbrlExposure } from "./exposure-aggregation";
import { assertHistoryAvailability, exposureHistoryRows, parseExposureHistory } from "./exposure-history";
import { parseXbrl } from "./xbrl-exposure";

function filing() {
  const html = `<xbrli:context id="c-1"><xbrli:period><xbrli:instant>2026-09-26</xbrli:instant></xbrli:period></xbrli:context><ix:nonFraction id="m-1" name="us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths" contextRef="c-1" unitRef="usd" scale="6">100</ix:nonFraction>`;
  return aggregateXbrlExposure(parseXbrl(html), { cik: 1, ticker: "AAA", accessionNo: "0000000001-26-000010", form: "10-K", filingDate: "2026-11-03", sourceUrl: "https://www.sec.gov/filing.htm", sourceHash: "abc" });
}

describe("exposure history availability", () => {
  it("anchors every measure to its filing date and preserves exact source facts", () => {
    const rows = exposureHistoryRows(filing(), "https://www.sec.gov/filing.htm", "abc");
    expect(rows).toHaveLength(1);
    expect(rows[0].availableAt).toBe(rows[0].filingDate);
    expect(rows[0].facts[0]).toMatchObject({ id: "m-1", rawValue: "100", value: 100000000, scale: "6", contextRef: "c-1" });
    expect(() => assertHistoryAvailability(rows[0])).not.toThrow();
  });

  it("fails closed if a measure could predate its filing", () => {
    const input = filing();
    input.measures[0].availableAt = "2026-11-02";
    expect(() => exposureHistoryRows(input, "https://www.sec.gov/filing.htm", "abc")).toThrow("Availability precedes filing");
    expect(() => assertHistoryAvailability({ ticker: "AAA", accessionNo: "accn", filingDate: "2026-11-03", availableAt: "2026-11-02" })).toThrow("Availability precedes filing");
  });

  it("round-trips immutable filing evidence and rejects duplicate measures", () => {
    const jsonl = exposureHistoryRows(filing(), "https://www.sec.gov/filing.htm", "abc").map(row => JSON.stringify(row)).join("\n");
    const parsed = parseExposureHistory(jsonl);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].measures[0]).toMatchObject({ kind: "debtMaturingNext12", value: 100000000, availableAt: "2026-11-03" });
    expect(parsed[0].measures[0].facts[0].excerpt).toContain("ix:nonFraction");
    expect(() => parseExposureHistory(`${jsonl}\n${jsonl}`)).toThrow("Duplicate exposure measure");
  });
});
