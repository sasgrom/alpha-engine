import { describe, expect, it } from "vitest";
import {
  buildClusters,
  classifyTransaction,
  filingLagDays,
  insiderRoles,
  type Form4Transaction,
} from "./insider-form4";

const base: Form4Transaction = {
  accessionNo: "0000050863-26-000195",
  issuerCik: 50863,
  ticker: "INTC",
  ownerName: "TAN LIP BU",
  ownerCik: "0001008463",
  isDirector: true,
  isOfficer: true,
  officerTitle: "CEO",
  isTenPercentHolder: false,
  preplanned: false,
  securityTitle: "Common Stock",
  transactionDate: "2026-11-02",
  transactionCode: "P",
  equitySwapInvolved: false,
  acquiredDisposedCode: "A",
  shares: 150000,
  pricePerShare: 64.7312,
  sharesOwnedAfter: 1464669,
  directOrIndirect: "I",
  natureOfOwnership: "by Family Trust",
  footnoteIds: ["F1"],
  filingDate: "2026-11-04",
  sourceUrl: "https://www.sec.gov/",
};

const at = (owner: string, date: string, code = "P"): Form4Transaction => ({
  ...base,
  ownerCik: owner,
  ownerName: owner,
  transactionDate: date,
  transactionCode: code,
});

describe("classifyTransaction", () => {
  it("includes open-market purchases (code P, acquired)", () => {
    expect(classifyTransaction(base)).toEqual({ included: true, reason: "open_market_purchase" });
  });
  it("excludes compensation and disposition codes with explicit reasons", () => {
    expect(classifyTransaction({ ...base, transactionCode: "M" })).toEqual({ included: false, reason: "option_exercise" });
    expect(classifyTransaction({ ...base, transactionCode: "F", acquiredDisposedCode: "D" })).toEqual({ included: false, reason: "tax_withholding" });
    expect(classifyTransaction({ ...base, transactionCode: "S", acquiredDisposedCode: "D" })).toEqual({ included: false, reason: "sale" });
    expect(classifyTransaction({ ...base, transactionCode: "A" })).toEqual({ included: false, reason: "grant_or_award" });
    expect(classifyTransaction({ ...base, transactionCode: "G" })).toEqual({ included: false, reason: "gift" });
  });
  it("excludes swaps and amount-less purchases", () => {
    expect(classifyTransaction({ ...base, equitySwapInvolved: true })).toEqual({ included: false, reason: "equity_swap" });
    expect(classifyTransaction({ ...base, pricePerShare: null })).toEqual({ included: false, reason: "missing_amounts" });
  });
});

describe("insiderRoles", () => {
  it("detects CEO from officer title", () => {
    expect(insiderRoles(base)).toContain("ceo");
    expect(insiderRoles(base)).toContain("director");
  });
  it("detects CFO and plain officers", () => {
    expect(insiderRoles({ ...base, isDirector: false, officerTitle: "CFO" })).toEqual(["cfo"]);
    expect(insiderRoles({ ...base, isDirector: false, officerTitle: "EVP, GM Foundry" })).toEqual(["officer"]);
  });
});

describe("buildClusters", () => {
  it("marks 3+ distinct insiders in 10 days as a cluster", () => {
    const clusters = buildClusters([at("1", "2026-11-02"), at("2", "2026-11-03"), at("3", "2026-11-05")]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].strength).toBe("cluster");
    expect(clusters[0].uniqueInsiders).toBe(3);
    expect(clusters[0].status).toBe("computed");
  });
  it("same insider twice is not a cluster", () => {
    const clusters = buildClusters([at("1", "2026-11-02"), at("1", "2026-11-03")]);
    expect(clusters[0].strength).toBe("single");
  });
  it("splits windows beyond 10 days", () => {
    const clusters = buildClusters([at("1", "2026-11-02"), at("2", "2026-11-30")]);
    expect(clusters).toHaveLength(2);
  });
  it("keeps tickers separate", () => {
    const clusters = buildClusters([at("1", "2026-11-02"), { ...at("2", "2026-11-03"), ticker: "NVDA" }]);
    expect(clusters).toHaveLength(2);
  });
});

describe("filingLagDays", () => {
  it("measures eventTs → availableAt lag", () => {
    expect(filingLagDays(base)).toBe(2);
  });
});
