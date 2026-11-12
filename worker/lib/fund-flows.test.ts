import { describe, expect, it } from "vitest";
import { FLOW_OUTSIDE } from "../../contracts/fund-flows";
import {
  addLinks,
  bookReturn,
  bookShape,
  commonRatio,
  flowOutcome,
  fundCategory,
  fundStory,
  impliedPrices,
  linksFromTotals,
  overlap,
  positionFlows,
  reportingChange,
  rotationLinks,
  shareBasisChange,
  snapSplit,
  splitFactor,
  styleTags,
  type Holding,
} from "./fund-flows";

describe("splits", () => {
  it("snaps a ratio to a plausible split and leaves ordinary moves alone", () => {
    expect(snapSplit(19.55)).toBe(20);
    expect(snapSplit(2.994)).toBe(3);
    expect(snapSplit(1.52)).toBe(1.5);
    expect(snapSplit(1.01)).toBe(1);
    expect(snapSplit(1.3)).toBe(1);
    expect(snapSplit(0.1265)).toBeCloseTo(1 / 8, 12);
  });

  it("reads the split from the raw price move against the adjusted close (figures of the stored filings)", () => {
    // Amazon, 20-for-1 in June 2022: raw 3247.05 → 108.19 while the adjusted close went 162.99 → 106.21
    expect(splitFactor(3247.05, 108.19, 162.99, 106.21)).toBe(20);
    // Tesla, 3-for-1 in August 2022; Nvidia, 10-for-1 in June 2024
    expect(splitFactor(674.24, 266.12, 224.47, 265.25)).toBe(3);
    expect(splitFactor(910.69, 125.15, 90.36, 123.54)).toBe(10);
    // no split: both prices move together; a dividend-sized difference is not a split
    expect(splitFactor(151.4, 182.77, 150.93, 182.15)).toBe(1);
    expect(splitFactor(100, 98, 100, 99.2)).toBe(1);
  });

  it("refuses to guess without adjusted closes when the raw move is extreme", () => {
    expect(splitFactor(3247.05, 108.19, null, null)).toBeNull();
    expect(splitFactor(100, 60, null, null)).toBe(1);
  });
});

describe("positionFlows", () => {
  const book = (rows: [number, number, number, number][]): Holding[] => rows.map(([fund, company, shares, value]) => ({ fund, company, shares, value }));

  it("values the split-corrected change in shares at the later quarter-end price", () => {
    const previous = book([[1, 10, 100, 300_000], [1, 11, 50, 5_000], [2, 10, 10, 30_000], [3, 10, 999, 1]]);
    const current = book([[1, 10, 2_400, 360_000], [1, 12, 40, 4_000], [2, 10, 200, 30_000]]);
    const prices = { before: impliedPrices(previous.filter((row) => row.fund !== 3)), after: impliedPrices(current) };
    const { flows } = positionFlows(previous, current, new Set([1, 2]), new Map([[10, 20]]), prices.before, prices.after);
    const of = (fund: number, company: number) => flows.find((flow) => flow.fund === fund && flow.company === company);
    // fund 1 held 100 shares = 2,000 after the split and now holds 2,400: bought 400 at $150
    expect(of(1, 10)).toEqual({ fund: 1, company: 10, usd: 400 * 150, kind: "add" });
    // fund 2 held exactly the split-adjusted amount: no trade
    expect(of(2, 10)).toBeUndefined();
    // an exit is valued at the earlier price when nobody holds the stock any more; a new position at the current one
    expect(of(1, 11)).toEqual({ fund: 1, company: 11, usd: -50 * 100, kind: "exit" });
    expect(of(1, 12)).toEqual({ fund: 1, company: 12, usd: 40 * 100, kind: "new" });
    // fund 3 is not in the comparable set
    expect(flows.some((flow) => flow.fund === 3)).toBe(false);
  });

  it("leaves out a position whose own price is far off the company's (a unit error in the filing)", () => {
    const previous = book([[1, 10, 100, 10_000], [2, 10, 100, 10_000]]);
    const current = book([[1, 10, 100, 10_000_000], [2, 10, 150, 15_000], [4, 10, 1_000_000, 100_000_000]]);
    const result = positionFlows(previous, current, new Set([1, 2]), new Map(), new Map([[10, 100]]), new Map([[10, 100]]));
    expect(result.suspect).toBe(1);
    expect(result.flows).toEqual([{ fund: 2, company: 10, usd: 5_000, kind: "add" }]);
  });
});

describe("what is not trading", () => {
  const book = (count: number, shares: (index: number) => number, value = 1e9): Holding[] => Array.from({ length: count }, (_, index) => ({ fund: 1, company: index + 1, shares: shares(index), value }));

  it("finds the ratio most values share, and none when they scatter", () => {
    // a share consolidation with a spin-off: every holder's count halves, a few also traded
    expect(commonRatio([...Array.from({ length: 30 }, () => 0.5), 0.41, 0.62, 0.55])).toBe(0.5);
    // ordinary trading: funds change their holdings by different amounts
    expect(commonRatio(Array.from({ length: 40 }, (_, index) => 0.6 + index * 0.02))).toBeNull();
    expect(commonRatio([0.5, 0.5, 0.5])).toBeNull();
  });

  it("reads from the holders what a company did to its shares", () => {
    // an ordinary quarter: the middle holder hardly moves, whatever the others do
    const ordinary = [...Array.from({ length: 60 }, (_, index) => 1 + (index % 5) * 0.002), ...Array.from({ length: 40 }, (_, index) => 0.4 + index * 0.04)];
    expect(shareBasisChange(ordinary)).toBeNull();
    // a spin-off with a one-for-two consolidation: every count halves and many funds trade on top (Honeywell, mid-2026)
    const consolidated = [0.32, 0.351, 0.452, 0.466, 0.481, 0.497, 0.5, 0.501, 0.501, 0.502, 0.502, 0.503, 0.505, 0.509, 0.523, 0.533, 0.559, 0.582, 0.591, 0.756, 1.0, 1.011];
    expect(shareBasisChange(consolidated)).toBe(0.5);
    // an exchange of shares at an odd ratio keeps the ratio the holders show
    expect(shareBasisChange(Array.from({ length: 30 }, () => 0.3737))).toBeCloseTo(0.3737, 12);
    // heavy selling by many is still trading
    expect(shareBasisChange(Array.from({ length: 30 }, (_, index) => 0.7 + index * 0.012))).toBeNull();
    expect(shareBasisChange([0.5, 0.5])).toBeNull();
  });

  it("tells a book moved at once from a book that was traded", () => {
    const previous = book(300, () => 1_000);
    // a manager moves a quarter of everything to another filing entity
    expect(reportingChange(previous, book(300, () => 750))).toBe(true);
    // an acquired firm's accounts appear in the report: most positions grow, by different amounts
    expect(reportingChange(previous, book(300, (index) => 1_150 + (index % 7) * 60))).toBe(true);
    // an index fund taking in money: every position 1% larger
    expect(reportingChange(previous, book(300, () => 1_010))).toBe(false);
    // a trading firm: positions change by anything between a quarter and four times, in both directions
    expect(reportingChange(previous, book(300, (index) => Math.round(1_000 * 2 ** (((index % 21) - 10) / 5))))).toBe(false);
    // a fund that sells half of its largest holdings changes a few positions, not the book
    expect(reportingChange(previous, book(300, (index) => (index < 12 ? 500 : 1_000)))).toBe(false);
    // a small fund may really grow by a third across the board; doubling at once it does not
    expect(reportingChange(book(300, () => 1_000, 1e8), book(300, () => 1_333, 1e8))).toBe(false);
    expect(reportingChange(book(300, () => 1_000, 1e8), book(300, () => 2_000, 1e8))).toBe(true);
    // half of a broad book appears or vanishes
    expect(reportingChange(previous, book(120, () => 1_000))).toBe(true);
    expect(reportingChange([], book(40, () => 1))).toBe(true);
    // a concentrated fund may sell most of what it holds
    expect(reportingChange(book(22, () => 1_000), book(9, () => 400))).toBe(false);
  });

  it("does not take a company's change of share basis for a change of the fund", () => {
    const previous = book(300, () => 1_000);
    const current = book(300, () => 500);
    expect(reportingChange(previous, current, new Map(previous.map((row) => [row.company, 0.5])))).toBe(false);
  });
});

describe("rotation", () => {
  it("pairs a fund's sales with its purchases and sends the remainder outside", () => {
    const links = rotationLinks(new Map([["Energy", 60], ["Health Care", 40]]), new Map([["Technology", 150]]));
    expect(links).toEqual([
      { from: "Energy", to: "Technology", usd: 60 },
      { from: "Health Care", to: "Technology", usd: 40 },
      { from: FLOW_OUTSIDE, to: "Technology", usd: 50 },
    ]);
    const leaving = rotationLinks(new Map([["Energy", 100]]), new Map([["Technology", 30], ["Financials", 10]]));
    expect(leaving).toEqual([
      { from: "Energy", to: "Technology", usd: 30 },
      { from: "Energy", to: "Financials", usd: 10 },
      { from: "Energy", to: FLOW_OUTSIDE, usd: 60 },
    ]);
    const total = new Map<string, number>();
    addLinks(total, links);
    addLinks(total, leaving);
    expect(linksFromTotals(total)[0]).toEqual({ from: "Energy", to: "Technology", usd: 90 });
    // every dollar sold and every dollar bought appears exactly once
    const all = linksFromTotals(total);
    expect(all.filter((link) => link.from !== FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0)).toBeCloseTo(200, 9);
    expect(all.filter((link) => link.to !== FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0)).toBeCloseTo(190, 9);
  });
});

describe("what followed", () => {
  it("weights the return of bought and sold dollars and reports the spread", () => {
    const outcome = flowOutcome([{ usd: 100, ret: 0.2 }, { usd: 300, ret: 0.0 }, { usd: -200, ret: -0.1 }, { usd: -50, ret: null }, { usd: 40, ret: null }]);
    expect(outcome.bought).toBeCloseTo(0.05, 12);
    expect(outcome.sold).toBeCloseTo(-0.1, 12);
    expect(outcome.spread).toBeCloseTo(0.15, 12);
    expect(flowOutcome([{ usd: 100, ret: 0.1 }])).toEqual({ bought: 0.1, sold: null, spread: null });
  });

  it("returns a book's value-weighted return only when most of its value has one", () => {
    expect(bookReturn([{ value: 900, ret: 0.1 }, { value: 100, ret: null }])).toBeCloseTo(0.1, 12);
    expect(bookReturn([{ value: 500, ret: 0.1 }, { value: 500, ret: null }])).toBeNull();
  });

  it("measures the overlap of two books", () => {
    const a = new Map([[1, 0.5], [2, 0.5]]);
    expect(overlap(a, a)).toBeCloseTo(1, 12);
    expect(overlap(a, new Map([[3, 1]]))).toBe(0);
    expect(overlap(a, new Map([[1, 1]]))).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("describing a fund", () => {
  it("derives concentration from the book", () => {
    const shape = bookShape([50, 30, 10, 10]);
    expect(shape.top10Share).toBe(1);
    expect(shape.effectivePositions).toBeCloseTo(1 / (0.25 + 0.09 + 0.01 + 0.01), 12);
    expect(bookShape([])).toEqual({ top10Share: null, effectivePositions: null });
  });

  it("shelves funds by curated list, tier, name and behaviour", () => {
    const broad = { positions: 370, turnover: 0.01, top10Share: 0.36, tracked: 2e12 };
    const narrow = { positions: 20, turnover: 0.1, top10Share: 0.8, tracked: 2e10 };
    expect(fundCategory("VANGUARD CAPITAL MANAGEMENT LLC", "institutional", broad)).toBe("index");
    expect(fundCategory("RENAISSANCE TECHNOLOGIES LLC", "quant", narrow)).toBe("quant");
    expect(fundCategory("Lone Pine Capital", "fundamental", narrow)).toBe("hedge");
    expect(fundCategory("CALIFORNIA PUBLIC EMPLOYEES RETIREMENT SYSTEM", "institutional", broad)).toBe("pension");
    expect(fundCategory("WELLS FARGO & COMPANY/MN", "institutional", { ...broad, turnover: 0.08 })).toBe("bank");
    expect(fundCategory("DODGE & COX", "institutional", narrow)).toBe("manager");
    expect(fundCategory("BERKSHIRE HATHAWAY INC", "institutional", narrow, "hedge")).toBe("hedge");
  });

  it("tags and tells the story from the record alone", () => {
    const shape = { tracked: 42.2e9, book: 280e9, positions: 11, top10Share: 0.99, effectivePositions: 4.2, turnover: 0.012, holdingYears: 20.8, over: { sector: "Financials", points: 0.31 }, under: { sector: "Health Care", points: -0.1 } };
    expect(styleTags(shape)).toEqual(["Concentrated", "Patient holder", "Financials tilt"]);
    const story = fundStory(shape, { firstQuarter: "2020-09-30", latestQuarter: "2026-06-30", growth: 2.31, growthAllFunds: 2.05, realGrowth: 1.84, tradeBought4: 0.18, tradeSold4: 0.11, latestNet: -3.2e9, biggestBuy: "OXY", biggestSale: "AAPL" });
    expect(story[0]).toBe("Holds $42 billion of the covered stocks in 11 positions, out of a whole 13F book of $280 billion.");
    expect(story[1]).toContain("99% of that: a concentrated book (it behaves like about 4 equal positions)");
    expect(story[2]).toContain("trades about 1.2% of the book a quarter, which works out to holding a typical position for roughly ten years or more");
    expect(story[3]).toContain("toward Financials (31 points more) and away from Health Care (10 points less)");
    expect(story[4]).toBe("A dollar in its reported books in Q3 2020 was $2.31 by Q2 2026 ($1.84 after inflation); all tracked funds together: $2.05.");
    expect(story[5]).toContain("bought returned 18% on average and what it sold 11%: its trading added about 7 points.");
    expect(story[6]).toBe("In Q2 2026 it was a net seller of $3.2 billion (largest purchase OXY, largest sale AAPL).");
  });

  it("says when a book is largely a hedge of options", () => {
    const shape = { tracked: 40e9, book: 90e9, positions: 350, top10Share: 0.3, effectivePositions: 80, turnover: 0.3, holdingYears: 0.8, over: null, under: null };
    const record = { firstQuarter: "2020-09-30", latestQuarter: "2026-06-30", growth: null, growthAllFunds: null, realGrowth: null, tradeBought4: null, tradeSold4: null, latestNet: null, biggestBuy: null, biggestSale: null };
    const told = fundStory(shape, { ...record, options: { puts: 55e9, calls: 62e9 } });
    expect(told.some((line) => line.startsWith("Beside the shares it reports options on the covered stocks: calls on $62 billion and puts on $55 billion of stock."))).toBe(true);
    // small option books and funds without options get no such sentence
    expect(fundStory(shape, { ...record, options: { puts: 1e9, calls: 2e9 } }).some((line) => line.includes("options"))).toBe(false);
    expect(fundStory(shape, record).some((line) => line.includes("options"))).toBe(false);
  });
});
