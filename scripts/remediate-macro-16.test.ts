import { describe, expect, it } from "vitest";
import { macro16Rows } from "./remediate-macro-16.mts";

describe("macro 16 reviewed-row remediation", () => {
  it("selects exactly ids 463333–463348 and excludes CPIAUCSL/FEDFUNDS", () => {
    const rows = macro16Rows();
    expect(rows.map((row: any) => row.id)).toEqual(Array.from({ length: 16 }, (_, index) => 463333 + index));
    expect(rows.every((row: any) => !["CPIAUCSL", "FEDFUNDS"].includes(row.seriesId))).toBe(true);
    expect(rows.every((row: any) => row.fetchedAt.startsWith("2026-11-07T01:23:"))).toBe(true);
    expect(rows.every((row: any) => row.sourceHash === null)).toBe(true);
  });
});
