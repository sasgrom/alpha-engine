// Unit tests for the 4m (D46) short-interest + macro parsers (pure paths).
import { describe, it, expect } from "vitest";
import { parseSiCsv, epochToDate, siField } from "./short-interest";
import { parseFredCsv } from "./macro";

describe("short-interest parsing", () => {
  it("reads the current + prior-month settlement points from the yahoo CSV", () => {
    const csv = "sharesShort,sharesShortPriorMonth,sharesShortPreviousMonthDate,dateShortInterest,shortRatio,shortPercentOfFloat\n120763539,139749097,1788134400,1790726400,2.82,0.0083\n";
    const pts = parseSiCsv(csv);
    expect(pts.length).toBe(2);
    expect(pts[0].settlementDate).toBe("2026-09-30");
    expect(pts[0].sharesShort).toBe(120763539);
    expect(pts[0].shortRatio).toBe(2.82);
    expect(pts[1].sharesShort).toBe(139749097);
    expect(pts[1].shortRatio).toBeNull(); // Yahoo carries no prior-month ratio
  });
  it("fails closed on missing/None values", () => {
    expect(siField({ a: "None" }, "a")).toBeNull();
    expect(siField({}, "missing")).toBeNull();
    expect(epochToDate(null)).toBeNull();
    expect(parseSiCsv("a,b\n")).toEqual([]);
  });
});

describe("FRED CSV parsing", () => {
  it("parses rows, keeps realtime windows, FRED '.' → null", () => {
    const csv = "date,realtime_end,realtime_start,value\n2026-10-19,2026-10-19,2026-10-19,4.06\n2026-10-20,2026-10-20,2026-10-20,\n2026-10-21,2026-10-21,2026-10-21,.\n";
    const pts = parseFredCsv(csv);
    expect(pts.length).toBe(3);
    expect(pts[0].value).toBe(4.06);
    expect(pts[1].value).toBeNull();
    expect(pts[2].value).toBeNull();
    expect(pts[0].realtimeStart).toBe("2026-10-19");
  });
});
