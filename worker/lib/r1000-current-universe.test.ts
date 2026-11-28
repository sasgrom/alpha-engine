import { describe, expect, it } from "vitest";
import { buildR1000CurrentUniverse, compareR1000Universe, gateR1000CurrentUniverse, type R1000CurrentUniverseRow } from "./r1000-current-universe";
import type { R1000SecurityType } from "./r1000-security-types";

const exchangeRows = [
  { cik: 1, ticker: "AAA", name: "Alpha", exchange: "NYSE" },
  { cik: 1, ticker: "AAAB", name: "Alpha", exchange: "NYSE" },
  { cik: 2, ticker: "BBB", name: "Beta", exchange: "NYSE" },
  { cik: 3, ticker: "CCC", name: "Registry", exchange: "NYSE" },
  { cik: 5, ticker: "EEE", name: "Leaver", exchange: "NYSE" },
];
const securityTypes: R1000SecurityType[] = exchangeRows.map(row => ({ ...row, assetType: "EQUITY", assetSubType: "COE", description: "COMMON", exchangeName: row.exchange }));
const companies = [
  { cik: 1, name: "Alpha", lastQuarter: "2026-09-30" },
  { cik: 2, name: "Beta", lastQuarter: "2026-03-31" },
  { cik: 3, name: "Registry", lastQuarter: "2026-09-30" },
  { cik: 4, name: "Gone", lastQuarter: "2025-12-31" },
];
const row = (cik: number, ticker = "AAA"): R1000CurrentUniverseRow => ({ cik, ticker, tickers: [ticker], name: String(cik), reason: "member", lastQuarter: "2026-09-30" });

describe("K35 current universe", () => {
  it("keeps member and former-listed companies, multiple classes and explicit exclusions", () => {
    const result = buildR1000CurrentUniverse({ companies, memberCiks: new Set([1]), registryCiks: new Set([3]), exchangeRows, securityTypes });
    expect(result.rows).toEqual([
      { cik: 1, ticker: "AAA", tickers: ["AAA", "AAAB"], name: "Alpha", reason: "member", lastQuarter: "2026-09-30" },
      { cik: 2, ticker: "BBB", tickers: ["BBB"], name: "Beta", reason: "former-listed", lastQuarter: "2026-03-31" },
    ]);
    expect(result.excluded).toEqual([
      { cik: 3, name: "Registry", reason: "already-in-registry" },
      { cik: 4, name: "Gone", reason: "no-verified-common-stock-listing" },
    ]);
  });

  it("selects the common primary and records every rejected security", () => {
    const listings = [
      { cik: 6, ticker: "PFD", name: "Multi Class", exchange: "NYSE" },
      { cik: 6, ticker: "COM", name: "Multi Class", exchange: "NYSE" },
      { cik: 7, ticker: "OTCX", name: "OTC issuer", exchange: "OTC" },
    ];
    const securities: R1000SecurityType[] = listings.map(row => ({ ...row, assetType: "EQUITY", assetSubType: row.ticker === "PFD" ? "PRF" : "COE", description: row.ticker, exchangeName: row.exchange }));
    const input = { companies: [{ cik: 6, name: "Multi Class", lastQuarter: "2026-09-30" }, { cik: 7, name: "OTC issuer", lastQuarter: "2026-09-30" }], memberCiks: new Set([6, 7]), registryCiks: new Set<number>(), exchangeRows: listings, securityTypes: securities };
    const result = buildR1000CurrentUniverse(input);
    expect(result.rows).toEqual([{ cik: 6, ticker: "COM", tickers: ["COM"], name: "Multi Class", reason: "member", lastQuarter: "2026-09-30" }]);
    expect(result.excludedTickers).toEqual([{ cik: 6, ticker: "PFD", reason: "non-common-subtype:PRF" }, { cik: 7, ticker: "OTCX", reason: "unapproved-otc-line" }]);
    expect(gateR1000CurrentUniverse({ ...input, rows: [row(7, "OTCX")], newQuarterArrived: false }).pass).toBe(false);
  });

  it("reports joiners and leavers by CIK", () => {
    const comparison = compareR1000Universe([row(2, "BBB"), row(5, "EEE")], [row(1), row(2, "BBB")]);
    expect(comparison.joiners.map(row => row.cik)).toEqual([1]);
    expect(comparison.leavers.map(row => row.cik)).toEqual([5]);
  });

  it("enforces uniqueness, ticker resolution and the same-quarter five-percent gate", () => {
    expect(gateR1000CurrentUniverse({ rows: [row(1), row(2, "BBB")], exchangeRows, securityTypes, previous: [row(1)], newQuarterArrived: false }).pass).toBe(false);
    expect(gateR1000CurrentUniverse({ rows: [row(1), row(1)], exchangeRows, securityTypes, previous: [row(1)], newQuarterArrived: true }).pass).toBe(false);
    expect(gateR1000CurrentUniverse({ rows: [row(1), row(2, "BBB")], exchangeRows, securityTypes, previous: [row(1), row(5, "EEE")], newQuarterArrived: false }).pass).toBe(true);
    expect(gateR1000CurrentUniverse({ rows: [row(1), row(2, "BBB")], exchangeRows, securityTypes, previous: [row(1)], newQuarterArrived: true }).pass).toBe(true);
  });
});
