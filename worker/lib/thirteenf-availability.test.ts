import { describe, expect, it } from "vitest";
import { buildPositionRow, mergeQuarterFilings, positionEvent, type QuarterFilingPart } from "./thirteenf";

const holding = (cusip: string) => ({ issuer: cusip, cusip, secClass: "COM", valueUsd: 100, shares: 100 });
const part = (accessionNo: string, filingDate: string, amendment: "ORIGINAL" | "NEW HOLDINGS"): QuarterFilingPart => ({
  accessionNo,
  filingDate,
  form: amendment === "ORIGINAL" ? "13F-HR" : "13F-HR/A",
  amendment,
  holdings: [holding(accessionNo)],
});

describe("13F filing availability", () => {
  it("makes a merged book available only after the latest required amendment", () => {
    const merged = mergeQuarterFilings([
      part("original", "2025-05-10", "ORIGINAL"),
      part("amendment", "2025-06-01", "NEW HOLDINGS"),
    ]);
    expect(merged.latestFilingDate).toBe("2025-06-01");
    expect(merged.latestFilingDate).not.toBe("2025-05-15");
  });

  it("uses the actual original filing date, never quarter-end, for original-only evidence", () => {
    const row = buildPositionRow(1, 320193, {
      accessionNo: "original",
      form: "13F-HR",
      filingDate: "2025-05-10",
      reportDate: "2025-03-31",
    }, positionEvent(null, 100, 100)!, "new position");
    expect(row.eventTs).toBe("2025-05-10 00:00:00");
    expect(row.eventTs).not.toBe("2025-03-31 00:00:00");
  });

  it("fails closed instead of creating research rows with missing filing metadata", () => {
    expect(() => mergeQuarterFilings([part("missing-date", "", "ORIGINAL")])).toThrow("MISSING_13F_FILING_DATE");
    expect(() => buildPositionRow(1, 320193, {
      accessionNo: "missing-date",
      form: "13F-HR",
      filingDate: "",
      reportDate: "2025-03-31",
    }, positionEvent(null, 100, 100)!, "missing date")).toThrow("MISSING_13F_FILING_DATE");
  });
});
