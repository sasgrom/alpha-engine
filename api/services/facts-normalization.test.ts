import { describe, expect, it } from "vitest";
import { factsToRows } from "./edgar";

describe("server companyfacts normalization", () => {
  it("accepts SEC's zero-padded string CIK as a number", () => {
    const rows = factsToRows({ cik: "0002115436", facts: { "us-gaap": { Assets: { units: { USD: [{ val: 1 }] } } } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].cik).toBe(2115436);
  });
});
