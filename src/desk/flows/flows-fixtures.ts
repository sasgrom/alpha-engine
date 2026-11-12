/** Small fund-flow files for the desk's tests: three quarters, three funds, four companies in two sectors. */
import type { FlowOutcome, FlowQuarter, FundFlowsCompany, FundFlowsFund, FundFlowsOverview } from "@contracts/fund-flows";

const outcome = (bought: number | null, sold: number | null): FlowOutcome => ({ bought, sold, spread: bought !== null && sold !== null ? bought - sold : null });

function quarter(date: string, previous: string, scale: number, cpi: number): FlowQuarter {
  return {
    quarter: date,
    previous,
    funds: 3,
    fundsLeftOut: 1,
    reportingChanges: ["Example Trust Bank"],
    bought: 90e9 * scale,
    sold: 70e9 * scale,
    net: 20e9 * scale,
    held: 4e12,
    sectors: [
      { sector: "Information Technology", bought: 70e9 * scale, sold: 30e9 * scale, net: 40e9 * scale, held: 3e12 },
      { sector: "Energy", bought: 20e9 * scale, sold: 40e9 * scale, net: -20e9 * scale, held: 1e12 },
    ],
    rotation: [
      { from: "Energy", to: "Information Technology", usd: 30e9 * scale },
      { from: "Outside", to: "Information Technology", usd: 20e9 * scale },
      { from: "Information Technology", to: "Energy", usd: 10e9 * scale },
    ],
    topBought: [
      { cik: 1045810, ticker: "NVDA", net: 30e9 * scale, bought: 45e9 * scale, sold: 15e9 * scale, buyers: 2, sellers: 1, opened: 1, closed: 0 },
      { cik: 320193, ticker: "AAPL", net: 10e9 * scale, bought: 25e9 * scale, sold: 15e9 * scale, buyers: 2, sellers: 1, opened: 0, closed: 0 },
    ],
    topSold: [{ cik: 34088, ticker: "XOM", net: -20e9 * scale, bought: 5e9 * scale, sold: 25e9 * scale, buyers: 1, sellers: 2, opened: 0, closed: 1 }],
    topBuyers: [{ cik: 2012383, net: 25e9 * scale, bought: 40e9 * scale, sold: 15e9 * scale }],
    topSellers: [{ cik: 1067983, net: -12e9 * scale, bought: 3e9 * scale, sold: 15e9 * scale }],
    companyFlows: [
      [1045810, 30e9 * scale, 1.6e12, 0.5],
      [320193, 10e9 * scale, 1.4e12, 0.21],
      [34088, -20e9 * scale, 0.6e12, -0.1],
      [93410, 0, 0.4e12, null],
    ],
    fundFlows: [
      [2012383, 40e9 * scale, 15e9 * scale],
      [1067983, 3e9 * scale, 15e9 * scale],
      [1423053, 47e9 * scale, 40e9 * scale],
    ],
    splits: ["NVDA ×10"],
    listed: ["GEV"],
    next1: outcome(0.06, 0.04),
    next4: outcome(0.2, 0.15),
    toDate: outcome(0.5, 0.25),
    followed: outcome(0.03, 0.035),
    allFundsReturn: 0.04,
    benchmarkReturn: 0.044,
    cpi,
  };
}

export const FLOWS_OVERVIEW: FundFlowsOverview = {
  schemaVersion: 1,
  generatedAt: "2026-11-12T04:00:00.000Z",
  codeVersion: "test",
  books: { generatedAt: "2026-11-12T03:55:00.000Z", codeVersion: "test", filings: 7219 },
  firstQuarter: "2025-12-31",
  latestQuarter: "2026-06-30",
  openQuarter: { quarter: "2026-09-30", funds: 51 },
  latestPriceDate: "2026-11-10",
  quarters: [quarter("2026-03-31", "2025-12-31", 0.8, 320), quarter("2026-06-30", "2026-03-31", 1, 330)],
  funds: [
    { cik: 2012383, name: "BlackRock", category: "index", tags: ["Giant", "Index-like"], latestQuarter: "2026-06-30", tracked: 5.4e12, book: 6.7e12, positions: 491, top10Share: 0.36, turnover: 0.006, quarters: 3, net: 25e9, growth: 1.35, growthAllFunds: 1.34, tradeSpread4: -0.02 },
    { cik: 1067983, name: "Berkshire Hathaway", category: "hedge", tags: ["Concentrated", "Patient holder"], latestQuarter: "2026-06-30", tracked: 291e9, book: 299e9, positions: 19, top10Share: 0.92, turnover: 0.012, quarters: 3, net: -12e9, growth: 1.9, growthAllFunds: 2.1, tradeSpread4: 0.04 },
    { cik: 1423053, name: "Citadel Advisors", category: "quant", tags: ["Fast trader"], latestQuarter: "2026-06-30", tracked: 164e9, book: 420e9, positions: 480, top10Share: 0.2, turnover: 0.4, quarters: 3, net: 7e9, growth: 2.2, growthAllFunds: 2.1, tradeSpread4: null },
    { cik: 102909, name: "Vanguard Group", category: "index", tags: ["Giant"], latestQuarter: "2025-12-31", tracked: 5.8e12, book: 6.9e12, positions: 491, top10Share: 0.35, turnover: 0.002, quarters: 1, net: null, growth: 1.2, growthAllFunds: 1.2, tradeSpread4: null },
  ],
  companies: [
    { cik: 1045810, ticker: "NVDA", name: "Nvidia", sector: "Information Technology", held: 1.6e12, holders: 3, net: 30e9 },
    { cik: 320193, ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology", held: 1.4e12, holders: 3, net: 10e9 },
    { cik: 34088, ticker: "XOM", name: "Exxon Mobil", sector: "Energy", held: 0.6e12, holders: 2, net: -20e9 },
    { cik: 93410, ticker: "CVX", name: "Chevron", sector: "Energy", held: 0.4e12, holders: 2, net: 0 },
  ],
};

export const FLOWS_FUND: FundFlowsFund = {
  cik: 1067983,
  name: "Berkshire Hathaway",
  category: "hedge",
  tags: ["Concentrated", "Patient holder"],
  story: ["Holds $291 billion of the covered stocks in 19 positions, out of a whole 13F book of $299 billion.", "It trades about 1.2% of the book a quarter, which works out to holding a typical position for roughly ten years or more."],
  options: { puts: 2e9, calls: 5e9 },
  latestQuarter: "2026-06-30",
  tracked: 291e9,
  book: 299e9,
  positions: 19,
  top10Share: 0.92,
  effectivePositions: 6,
  turnover: 0.012,
  holdingYears: 20,
  series: [
    { quarter: "2025-12-31", tracked: 267e9, book: 274e9, positions: 26, bought: null, sold: null, net: null, paperReturn: null, growth: null, growthAllFunds: null, cpi: 315, next4: outcome(null, null) },
    { quarter: "2026-03-31", tracked: 256e9, book: 263e9, positions: 19, bought: 2e9, sold: 14e9, net: -12e9, paperReturn: -0.02, growth: 0.98, growthAllFunds: 0.96, cpi: 320, next4: outcome(0.1, 0.02) },
    { quarter: "2026-06-30", tracked: 291e9, book: 299e9, positions: 19, bought: 3e9, sold: 15e9, net: -12e9, paperReturn: 0.14, growth: 1.12, growthAllFunds: 1.11, cpi: 330, next4: outcome(null, null) },
  ],
  sectors: [{ sector: "Information Technology", weight: 0.3, allFunds: 0.75 }, { sector: "Energy", weight: 0.7, allFunds: 0.25 }],
  topPositions: [
    { cik: 320193, ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology", usd: 80e9, weight: 0.27, heldSince: "2025-12-31", flow: -15e9 },
    { cik: 93410, ticker: "CVX", name: "Chevron", sector: "Energy", usd: 20e9, weight: 0.07, heldSince: "2025-12-31", flow: 3e9 },
  ],
  moves: [
    { quarter: "2026-06-30", buys: [{ cik: 93410, ticker: "CVX", usd: 3e9, kind: "add", since: 0.08 }], sells: [{ cik: 320193, ticker: "AAPL", usd: -15e9, kind: "trim", since: 0.21 }] },
    { quarter: "2026-03-31", buys: [{ cik: 93410, ticker: "CVX", usd: 2e9, kind: "new", since: 0.2 }], sells: [{ cik: 320193, ticker: "AAPL", usd: -14e9, kind: "trim", since: 0.3 }] },
  ],
  alike: [{ cik: 2012383, name: "BlackRock", overlap: 0.31 }],
};

export const FLOWS_COMPANY: FundFlowsCompany = {
  cik: 320193,
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Information Technology",
  series: [
    { quarter: "2026-03-31", net: 8e9, bought: 20e9, sold: 12e9, buyers: 2, sellers: 1, opened: 0, closed: 0, holders: 3, held: 1.2e12, next1: 0.15, next4: null },
    { quarter: "2026-06-30", net: 10e9, bought: 25e9, sold: 15e9, buyers: 2, sellers: 1, opened: 0, closed: 0, holders: 3, held: 1.4e12, next1: null, next4: null },
  ],
  holders: [{ cik: 2012383, name: "BlackRock", usd: 420e9, weight: 0.078 }, { cik: 1067983, name: "Berkshire Hathaway", usd: 80e9, weight: 0.27 }],
  quarters: [
    { quarter: "2026-06-30", buyers: [{ cik: 2012383, name: "BlackRock", usd: 18e9, kind: "add" }], sellers: [{ cik: 1067983, name: "Berkshire Hathaway", usd: -15e9, kind: "trim" }] },
    { quarter: "2026-03-31", buyers: [{ cik: 2012383, name: "BlackRock", usd: 12e9, kind: "add" }], sellers: [{ cik: 1067983, name: "Berkshire Hathaway", usd: -14e9, kind: "trim" }] },
  ],
};
