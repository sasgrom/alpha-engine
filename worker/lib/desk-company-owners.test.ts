import { describe, expect, it } from "vitest";
import { buildDeskCompanyHolders, buildDeskCompanyInsiders, buildDeskInsiderMarket, type InsiderFilingDoc, type ThirteenFCompanyQuarter } from "./desk-company";

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
  groupId: "g:ceo", derivative: false, transactionDate: "2026-10-01", code: "S", shares: 1000, price: 200, valueUsd: 200_000, plan10b5: false, duplicateOf: null, flags: [], directOrIndirect: "D", ...over,
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

  it("keeps the open-market trades ahead of the grants and tax lines when the list is cut", () => {
    const grants = Array.from({ length: 5 }, (_, index) => line({ transactionDate: `2026-10-0${index + 1}`, code: "A", price: null, valueUsd: null, shares: 100 + index }));
    const out = buildDeskCompanyInsiders({
      cik: 5, ticker: "INSD", asOf: "2026-11-13", builtAt: "", marketLimit: 2, otherLimit: 3,
      filings: [
        filing("2026-10-06", [CEO], grants),
        // older than every grant: it stays in the file all the same
        filing("2025-02-12", [DIRECTOR], [line({ groupId: "g:dir", transactionDate: "2025-02-10", code: "P", shares: 500, price: 190, valueUsd: 95_000 })]),
        filing("2024-06-12", [CEO], [line({ transactionDate: "2024-06-10" }), line({ transactionDate: "2024-06-11", valueUsd: 210_000 })]),
      ],
    })!;
    expect(out).toMatchObject({ tradeCount: 8, marketCount: 3 });
    // the three newest grants, then the two newest market trades of the three
    expect(out.trades.map((trade) => [trade.date, trade.code])).toEqual([["2026-10-05", "A"], ["2026-10-04", "A"], ["2026-10-03", "A"], ["2025-02-10", "P"], ["2024-06-11", "S"]]);
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

  it("counts a trade once when a related owner reports it again as held indirectly, and two people's own equal trades twice", () => {
    const HOLDING = owner("LOR INC", "g:lor", { tenPercentOwner: true }), TRUST = owner("ROLLINS VOTING TRUST", "g:trust", { tenPercentOwner: true });
    const bought = { transactionDate: "2026-10-29", code: "P", shares: 1_444_402, price: 34.5864, valueUsd: 49_956_665 };
    // the company bought; the trust that holds through it reports the same purchase in a report of its own
    const same = [filing("2026-11-02", [HOLDING], [line({ ...bought, groupId: "g:lor" })]), filing("2026-11-02", [TRUST], [line({ ...bought, groupId: "g:trust", directOrIndirect: "I" })])];
    const market = buildDeskInsiderMarket({
      asOf: "2026-11-13", builtAt: "",
      companies: [
        { cik: 5, ticker: "SAME", filings: same },
        // two officers each sold their own 3,000 shares at the day's price
        { cik: 6, ticker: "BOTH", filings: [filing("2026-10-16", [CEO], [line({ shares: 3000, price: 156.22, valueUsd: 468_660 })]), filing("2026-10-16", [DIRECTOR], [line({ groupId: "g:dir", shares: 3000, price: 156.22, valueUsd: 468_660 })])] },
      ],
    })!;
    expect(market.totals).toMatchObject({ bought: 49_956_665, buyers: 1, sold: 937_320, sellers: 2 });
    expect(market.purchases.map((row) => row.owner)).toEqual(["LOR INC"]);
    // one buyer makes no window of several insiders
    expect(market.windows).toEqual([]);
    // the company's own page counts it the same way
    expect(build(same)).toMatchObject({ tradeCount: 1, year: { bought: 49_956_665, buyers: 1 } });
  });

  it("keeps a line the standard flags, without a dollar value, and names joint reporters once", () => {
    const out = build([
      filing("2026-09-02", [owner("SEQUOIA CAPITAL FUND", "g:vc", { tenPercentOwner: true }), owner("SEQUOIA PARTNERS", "g:vc", { tenPercentOwner: true }), DIRECTOR],
        [line({ groupId: "g:vc", transactionDate: "2026-09-01", valueUsd: 9e15, flags: ["price_outlier"] }), line({ groupId: "g:vc", transactionDate: "2026-09-01", price: null, valueUsd: null, code: "G" })]),
    ]);
    expect(out.trades[0]).toMatchObject({ owner: "SEQUOIA CAPITAL FUND", more: 1, role: "10% owner", valueUsd: null });
    expect(out.year).toEqual({ bought: 0, sold: 0, buyers: 0, sellers: 0, soldUnderPlan: 0 });
  });

  it("reads insider trading across companies: recent totals, purchases, buying windows and the largest net buyers and sellers", () => {
    const CFO = owner("MAESTRI LUCA", "g:cfo", { officer: true, officerTitle: "Chief Financial Officer" });
    const buy = (date: string, groupId: string, valueUsd: number) => line({ groupId, transactionDate: date, code: "P", shares: valueUsd / 100, price: 100, valueUsd });
    const market = buildDeskInsiderMarket({
      asOf: "2026-11-13", builtAt: "",
      companies: [
        { cik: 5, ticker: "BUYS", filings: [
          filing("2026-11-03", [CEO], [buy("2026-11-02", "g:ceo", 500_000)]),
          filing("2026-11-10", [DIRECTOR], [buy("2026-11-09", "g:dir", 100_000)]),
          // the same insider again within the ten days: one more purchase of the same window
          filing("2026-11-12", [CEO], [buy("2026-11-12", "g:ceo", 50_000), line({ transactionDate: "2026-11-12", code: "F", valueUsd: 9_000 })]),
          // five months ago: listed among the purchases, outside the recent period; an amended copy and a flagged line count nowhere
          filing("2026-06-12", [CFO], [buy("2026-06-10", "g:cfo", 70_000), line({ groupId: "g:cfo", transactionDate: "2026-06-10", code: "P", valueUsd: 9e15, flags: ["price_outlier"] })]),
          filing("2026-06-20", [CFO], [buy("2026-06-10", "g:cfo", 70_000)], "4/A"),
        ] },
        { cik: 6, ticker: "SELL", filings: [filing("2026-10-03", [CEO], [line({ valueUsd: 900_000, plan10b5: true }), line({ transactionDate: "2026-10-02", valueUsd: 100_000 })])] },
        { cik: 7, ticker: "NONE", filings: [] },
      ],
    })!;
    expect(market).toMatchObject({ version: "i-test", asOf: "2026-11-13", companies: 2, days: 90 });
    expect(market.totals).toEqual({ bought: 650_000, sold: 1_000_000, buyers: 2, sellers: 1, buyingCompanies: 1, sellingCompanies: 1, soldUnderPlan: 900_000 });
    expect(market.purchases.map((row) => [row.ticker, row.date, row.owner, row.role, row.valueUsd])).toEqual([
      ["BUYS", "2026-11-12", "COOK TIMOTHY D", "Chief Executive Officer", 50_000],
      ["BUYS", "2026-11-09", "LEVINSON ARTHUR D", "Director", 100_000],
      ["BUYS", "2026-11-02", "COOK TIMOTHY D", "Chief Executive Officer", 500_000],
      ["BUYS", "2026-06-10", "MAESTRI LUCA", "Chief Financial Officer", 70_000],
    ]);
    // the chief executive twice and a director within ten days: one window of two insiders; June's lone buyer makes none
    expect(market.windows).toEqual([{ cik: 5, ticker: "BUYS", start: "2026-11-02", end: "2026-11-12", insiders: 2, valueUsd: 650_000, roles: ["Chief Executive Officer", "Director"] }]);
    expect(market.netBuyers.map((row) => [row.ticker, row.bought, row.sold, row.buyers])).toEqual([["BUYS", 650_000, 0, 2]]);
    expect(market.netSellers.map((row) => [row.ticker, row.sold, row.soldUnderPlan, row.sellers])).toEqual([["SELL", 1_000_000, 900_000, 1]]);
    expect(buildDeskInsiderMarket({ companies: [{ cik: 7, ticker: "NONE", filings: [] }], asOf: "2026-11-13", builtAt: "" })).toBeNull();
  });

  it("leaves old filings out of the list but inside the quarters, and returns nothing without filings", () => {
    const out = build([filing("2023-02-03", [CEO], [line({ transactionDate: "2023-02-01" })])]);
    expect(out.trades).toEqual([]);
    expect(out.quarters.find((row) => row.quarter === "2023-03-31")).toMatchObject({ sold: 200_000, sellers: 1 });
    expect(buildDeskCompanyInsiders({ cik: 5, ticker: "INSD", filings: [], asOf: "2026-11-13", builtAt: "" })).toBeNull();
  });
});
