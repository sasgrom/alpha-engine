import { describe, expect, it } from "vitest";
import { canonicalTicker, exactSecDirectoryEntry, type SecDirectoryCompany } from "./canonical-ticker";
import { GICS_BY_TICKER } from "./gics-snapshot";

const entry = (cik: number, ticker: string): SecDirectoryCompany => ({ cik, ticker, name: `${ticker} Inc`, exchange: "NYSE" });

describe("canonical ticker selection", () => {
  it.each([
    [12927, "BA", "BA-PA"],
    [886982, "GS", "GS-PD"],
    [927628, "COF", "COF-PN"],
    [753308, "NEE", "NEE-PW"],
    [1375365, "SMCI", "SMCIP"],
    [1506307, "KMI", "EP-PC"],
  ])("keeps the GICS common ticker for CIK %i", (cik, expected, preferred) => {
    expect(canonicalTicker(cik, preferred)).toBe(expected);
    expect(exactSecDirectoryEntry([entry(cik, preferred), entry(cik, expected)], cik, expected)?.ticker).toBe(expected);
  });

  it("preserves an explicitly requested ticker outside GICS", () => {
    expect(canonicalTicker(999999, "PRIVATE")).toBe("PRIVATE");
  });

  it.each([["GOOG", "GOOGL"], ["FOX", "FOXA"], ["NWS", "NWSA"]])("keeps %s and %s as separate share classes", (first, second) => {
    const firstGics = GICS_BY_TICKER.get(first)!;
    const secondGics = GICS_BY_TICKER.get(second)!;
    expect(firstGics.cik).toBe(secondGics.cik);
    expect(canonicalTicker(firstGics.cik, first)).toBe(first);
    expect(canonicalTicker(secondGics.cik, second)).toBe(second);
    expect(canonicalTicker(firstGics.cik, first)).not.toBe(canonicalTicker(secondGics.cik, second));
  });

  it("does not choose a preferred ticker when the exact GICS and SEC pair is absent", () => {
    expect(exactSecDirectoryEntry([entry(12927, "BA-PA")], 12927, "BA")).toBeNull();
  });
});
