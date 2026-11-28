import { describe, expect, it } from "vitest";
import { r1000ScopeDocumentSizes, r1000ScopeFilings, R1000_EDGAR_FORMS } from "./r1000-edgar-scope";

const filing = (accessionNo: string, form: string, filingDate: string, primaryDoc = "main.htm") => ({ accessionNo, form, filingDate, primaryDoc });

describe("Russell release-calendar collection scope", () => {
  it("keeps every addendum form and only the panel-era dates", () => {
    const rows = [filing("a", "10-K", "2019-01-01"), filing("b", "10-Q/A", "2020-01-01"), filing("c", "8-K/A", "2026-01-01"), filing("d", "8-K", "2018-12-31"), filing("e", "DEF 14A", "2026-01-01")];
    expect(r1000ScopeFilings(rows).map(row => row.accessionNo)).toEqual(["a", "b", "c"]);
    expect(R1000_EDGAR_FORMS).toEqual(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);
  });

  it("uses index sizes and mirrors the largest-document fallback without hiding missing sources", () => {
    const filings = [filing("a", "8-K", "2026-01-01"), filing("b", "10-Q", "2026-01-01"), filing("c", "8-K/A", "2026-01-01", "missing.htm"), filing("d", "10-K", "2026-01-01")];
    const documents = new Map([
      ["a", [{ name: "main.htm", size: 10 }, { name: "ex99.htm", size: 100 }, { name: "small.txt", size: 20 }]],
      ["b", [{ name: "main.htm", size: 50 }]],
      ["c", [{ name: "other.htm", size: 30 }]],
    ]);
    const result = r1000ScopeDocumentSizes(filings, documents);
    expect(result).toMatchObject({ filings: 4, primaryBytes: 90, optionalExhibitBytes: 100, missingPrimaryDocuments: ["d"] });
    expect(result.byForm["8-K"]).toEqual({ filings: 1, primaryBytes: 10, optionalExhibitBytes: 100 });
    expect(result.byForm["10-Q"]).toEqual({ filings: 1, primaryBytes: 50, optionalExhibitBytes: 0 });
  });
});
