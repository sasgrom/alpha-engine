import { describe, expect, it } from "vitest";
import { canonicalTicker, exactSecDirectoryEntry, registryCorrections, type SecDirectoryCompany } from "./canonical-ticker";
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

describe("registry audit", () => {
  const bac = GICS_BY_TICKER.get("BAC")!;
  const orcl = GICS_BY_TICKER.get("ORCL")!;
  const brk = GICS_BY_TICKER.get("BRK-B")!;
  const googl = GICS_BY_TICKER.get("GOOGL")!;

  it("replaces another security of the filer with the index's common share and fills a missing classification", () => {
    const rows = [
      { cik: bac.cik, ticker: "MER-PK", sector: bac.sector, industry: bac.industry },
      { cik: orcl.cik, ticker: "ORCL-PD", sector: null, industry: null },
      { cik: brk.cik, ticker: "BRK-A", sector: brk.sector, industry: brk.industry },
      { cik: googl.cik, ticker: "GOOGL", sector: googl.sector, industry: googl.industry },
      { cik: 999999, ticker: "PRIV-PA", sector: null, industry: null },
    ];
    expect(registryCorrections(rows)).toEqual(
      [
        { cik: bac.cik, field: "ticker", before: "MER-PK", after: "BAC" },
        { cik: orcl.cik, field: "industry", before: null, after: orcl.industry },
        { cik: orcl.cik, field: "sector", before: null, after: orcl.sector },
        { cik: orcl.cik, field: "ticker", before: "ORCL-PD", after: "ORCL" },
        { cik: brk.cik, field: "ticker", before: "BRK-A", after: "BRK-B" },
      ].sort((a, b) => a.cik - b.cik || a.field.localeCompare(b.field)),
    );
  });

  it("prefers the traded ticker when it is one of the member's index tickers", () => {
    const row = { cik: googl.cik, ticker: "GOOGM", sector: googl.sector, industry: googl.industry };
    expect(registryCorrections([row], new Map([[googl.cik, "GOOGL"]]))).toEqual([{ cik: googl.cik, field: "ticker", before: "GOOGM", after: "GOOGL" }]);
    expect(registryCorrections([row], new Map([[googl.cik, "NOT-IT"]]))[0].after).toBe(canonicalTicker(googl.cik, "GOOGM"));
    expect(registryCorrections([{ ...row, ticker: "GOOG" }])).toEqual([]);
  });
});
