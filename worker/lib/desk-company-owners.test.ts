import { describe, expect, it } from "vitest";
import { buildDeskCompanyHolders, buildDeskCompanyInsiders, type InsiderFilingDoc, type ThirteenFCompanyQuarter } from "./desk-company";

const quarter = (over: Partial<ThirteenFCompanyQuarter>): ThirteenFCompanyQuarter => ({
  cik: 5, period: "2026-06-30", knownAt: "2026-08-17", rowKind: "deadline", holders: 260, valueHeldUsd: 2.4e12, percentOfSharesOutstanding: 57.2, percentAbove100: false,
  continuingFunds: 285, entries: 6, exits: 5, breadthChange: 0.0035, sharesBought: 300e6, sharesSold: 120e6, top10Share: 0.557, fundsFiled: 301, fundsInBook: 307, buildVersion: "k-test", ...over,
});

describe("desk company holders", () => {
  it("takes the later of a quarter's two rows, the one with the late reports, oldest quarter first", () => {
    const out = buildDeskCompanyHolders({
      cik: 5, ticker: "HOLD", builtAt: "",
      rows: [
        quarter({}),
        quarter({ knownAt: "2026-08-31", rowKind: "plus_10", holders: 270, fundsFiled: 307, percentOfSharesOutstanding: 57.5 }),
        quarter({ period: "2026-03-31", knownAt: "2026-05-18", holders: 255 }),
      ],
    })!;
    expect(out.version).toBe("k-test");
    expect(out.quarters.map((row) => [row.period, row.knownAt, row.holders])).toEqual([["2026-03-31", "2026-05-18", 255], ["2026-06-30", "2026-08-31", 270]]);
    expect(out.quarters[1]).toMatchObject({ fundsFiled: 307, fundsInBook: 307, shareOfStock: 0.575, entries: 6, exits: 5, continuing: 285, top10Share: 0.557, valueUsd: 2.4e12 });
  });

  it("gives no share of the stock where the standard marks it unusable, keeps the newest quarters, and nothing without rows", () => {
    const rows = [quarter({ period: "2025-12-31", knownAt: "2026-02-17" }), quarter({ period: "2026-03-31", knownAt: "2026-05-18", percentOfSharesOutstanding: 559, percentAbove100: true }), quarter({ percentOfSharesOutstanding: null })];
    const out = buildDeskCompanyHolders({ cik: 5, ticker: "HOLD", builtAt: "", rows, quarters: 2 })!;
    expect(out.quarters.map((row) => [row.period, row.shareOfStock])).toEqual([["2026-03-31", null], ["2026-06-30", null]]);
    expect(buildDeskCompanyHolders({ cik: 5, ticker: "HOLD", builtAt: "", rows: [] })).toBeNull();
  });
});

const owner = (ownerName: string, groupId: string, over: Partial<InsiderFilingDoc["owners"][number]> = {}) => ({ ownerName, groupId, director: false, officer: false, officerTitle: null, tenPercentOwner: false, ...over });
const line = (over: Partial<InsiderFilingDoc["transactions"][number]>): InsiderFilingDoc["transactions"][number] => ({
  groupId: "g:ceo", derivative: false, transactionDate: "2026-10-01", code: "S", shares: 1000, price: 200, valueUsd: 200_000, plan10b5: false, duplicateOf: null, flags: [], ...over,
});
const filing = (filingDate: string, owners: InsiderFilingDoc["owners"], transactions: InsiderFilingDoc["transactions"], form = "4"): InsiderFilingDoc => ({
  filing: { accessionNo: `a-${filingDate}-${transactions.length}`, form, filingDate, buildVersion: "i-test" }, owners, transactions,
});
const CEO = owner("COOK TIMOTHY D", "g:ceo", { officer: true, officerTitle: "Chief Executive Officer" });
const DIRECTOR = owner("LEVINSON ARTHUR D", "g:dir", { director: true });
const build = (filings: InsiderFilingDoc[]) => buildDeskCompanyInsiders({ cik: 5, ticker: "INSD", filings, asOf: "2026-11-13", builtAt: "" })!;

describe("desk company insiders", () => {
  it("lists the stock lines newest first with who traded, and sums open-market purchases and sales by quarter and for the year", () => {
    const out = build([
      filing("2026-10-03", [CEO], [line({}), line({ code: "F", price: 200, valueUsd: 50_000, shares: 250 })]),
      filing("2026-08-12", [DIRECTOR], [line({ groupId: "g:dir", transactionDate: "2026-08-10", code: "P", shares: 500, price: 190, valueUsd: 95_000 })]),
      filing("2026-05-05", [CEO], [line({ transactionDate: "2026-05-04", plan10b5: true, valueUsd: 300_000, shares: 1500 })]),
    ]);
    expect(out).toMatchObject({ version: "i-test", asOf: "2026-11-13", tradeCount: 4 });
    expect(out.trades.map((trade) => [trade.date, trade.code, trade.owner, trade.role])).toEqual([
      ["2026-10-01", "S", "COOK TIMOTHY D", "Chief Executive Officer"],
      ["2026-10-01", "F", "COOK TIMOTHY D", "Chief Executive Officer"],
      ["2026-08-10", "P", "LEVINSON ARTHUR D", "Director"],
      ["2026-05-04", "S", "COOK TIMOTHY D", "Chief Executive Officer"],
    ]);
    // twenty calendar quarters ending with the one the standard's last filing is in
    expect(out.quarters).toHaveLength(20);
    expect(out.quarters[0].quarter).toBe("2022-03-31");
    expect(out.quarters.slice(-3)).toEqual([
      { quarter: "2026-06-30", bought: 0, sold: 300_000, buyers: 0, sellers: 1 },
      { quarter: "2026-09-30", bought: 95_000, sold: 0, buyers: 1, sellers: 0 },
      { quarter: "2026-12-31", bought: 0, sold: 200_000, buyers: 0, sellers: 1 },
    ]);
    // tax withholding is not a market trade: it is listed, not summed
    expect(out.year).toEqual({ bought: 95_000, sold: 500_000, buyers: 1, sellers: 1, soldUnderPlan: 300_000 });
  });

  it("counts each trade once: no amended reports, no duplicate copies, no derivative lines", () => {
    const out = build([
      filing("2026-10-03", [CEO], [line({})]),
      filing("2026-10-20", [CEO], [line({ valueUsd: 210_000 })], "4/A"),
      filing("2026-10-04", [CEO, owner("COOK FAMILY TRUST", "g:ceo")], [line({ duplicateOf: "t:earlier" }), line({ derivative: true, code: "M" })]),
    ]);
    expect(out.tradeCount).toBe(1);
    expect(out.year.sold).toBe(200_000);
  });

  it("keeps a line the standard flags, without a dollar value, and names joint reporters once", () => {
    const out = build([
      filing("2026-09-02", [owner("SEQUOIA CAPITAL FUND", "g:vc", { tenPercentOwner: true }), owner("SEQUOIA PARTNERS", "g:vc", { tenPercentOwner: true }), DIRECTOR],
        [line({ groupId: "g:vc", transactionDate: "2026-09-01", valueUsd: 9e15, flags: ["price_outlier"] }), line({ groupId: "g:vc", transactionDate: "2026-09-01", price: null, valueUsd: null, code: "G" })]),
    ]);
    expect(out.trades[0]).toMatchObject({ owner: "SEQUOIA CAPITAL FUND", more: 1, role: "10% owner", valueUsd: null });
    expect(out.year).toEqual({ bought: 0, sold: 0, buyers: 0, sellers: 0, soldUnderPlan: 0 });
  });

  it("leaves old filings out of the list but inside the quarters, and returns nothing without filings", () => {
    const out = build([filing("2023-02-03", [CEO], [line({ transactionDate: "2023-02-01" })])]);
    expect(out.trades).toEqual([]);
    expect(out.quarters.find((row) => row.quarter === "2023-03-31")).toMatchObject({ sold: 200_000, sellers: 1 });
    expect(buildDeskCompanyInsiders({ cik: 5, ticker: "INSD", filings: [], asOf: "2026-11-13", builtAt: "" })).toBeNull();
  });
});
