/**
 * Test harness of the desk view (imported only by the desk's *.test.tsx files): a fixture snapshot, a tRPC fetch
 * mock that answers batched requests procedure by procedure, and a mount helper. Each test file gets its own query
 * cache because vitest isolates modules per file — keep one role per file.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { TRPCProvider } from "@/providers/trpc";
import type { DeskCompany, DeskSnapshot } from "@contracts/desk-snapshot";
import type { DeskIntradayMarket, DeskIntradayResponse, DeskIntradaySeries } from "@contracts/intraday";
import { SECTOR_NAME_BY_FUND } from "@contracts/intraday";
import DeskApp from "./DeskApp";
import { ENGINE_COMPANY, ENGINE_INDEX } from "./engine/engine-fixtures";
import { FLOWS_COMPANY, FLOWS_FUND, FLOWS_OVERVIEW } from "./flows/flows-fixtures";

const returns = (d1: number) => ({ d1, w1: d1 * 2, m1: d1 * 3, m3: d1 * 4, ytd: d1 * 5, y1: d1 * 6 });

function row(ticker: string, name: string, cik: number, marketCap: number, d1: number): DeskCompany {
  return {
    ticker, registryTicker: ticker, cik, name, sector: "Information Technology", industry: null, research: true, close: 100, lastDate: "2026-11-10", returns: returns(d1),
    high52: 120, low52: 80, ma50: 99, ma200: 90, vol20: 0.3, marketCap, pe: 30, beta: 1.1, dividendYield: 0.004, epsTtm: 3, lastEarnings: "2026-11-05",
    lastEarningsReaction: 0.031, lastEarningsReactionSessions: 2, nextEarnings: "2026-11-18", nextEarningsBasis: "history", options: null, spark: [98, 99, 100],
    lastEarningsDrift: 0.012, lastEarningsDriftSessions: 3, momentum12m1: 0.4, shortInterest: null, insiders: null,
  };
}

export const SNAPSHOT: DeskSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-11-11T00:00:00.000Z",
  codeVersion: "test",
  session: "2026-11-10",
  previousSession: "2026-11-09",
  inputs: { priceRows: 0, priceSeries: 3, latestPriceDate: "2026-11-10", schwabQuoteDates: [], fundamentals: 3, quotes: 3, optionTickers: 0, optionsGeneratedAt: null, earningsEvents: 0, companiesWithoutPrices: [] },
  benchmark: { ticker: "SPY", close: 749.92, lastDate: "2026-11-10", returns: returns(-0.0037), spark: [740, 745, 749.92] },
  breadth: { measured: 3, advancers: 2, decliners: 1, unchanged: 0, medianChange: 0.01, newHighs: 1, newLows: 0, aboveMa50: 3, withMa50: 3, aboveMa200: 3, withMa200: 3 },
  sectors: [{ name: "Information Technology", companies: 3, marketCap: 1.3e13, returns: returns(0.004), advancers: 2, decliners: 1 }],
  companies: [
    {
      ...row("AAPL", "Apple Inc.", 320193, 5.1e12, 0.012),
      shortInterest: { date: "2026-10-15", shares: 131_600_000, pctFloat: null, daysToCover: 3.7, changePct: null },
      insiders: { buys: 2, buyers: 2, buyUsd: 469_274, lastBuy: "2026-11-02", sells: 1, sellUsd: 824_000 },
      options: {
        capturedAt: "2026-11-11T12:01:44.691Z",
        rv20: 0.267,
        ivRvSpread: 0.049,
        buckets: [
          { bucket: "1-7D", days: 5, atmIv: 0.282, expectedMovePct: 0.033, skew25: 0.02, putCallOiRatio: 0.6 },
          { bucket: "8-30D", days: 16, atmIv: 0.24, expectedMovePct: 0.05, skew25: 0.024, putCallOiRatio: 0.53 },
          { bucket: "31-90D", days: 43, atmIv: 0.225, expectedMovePct: 0.077, skew25: 0.03, putCallOiRatio: 0.7 },
        ],
      },
    },
    row("NVDA", "Nvidia", 1045810, 4.3e12, -0.0547),
    row("MSFT", "Microsoft", 789019, 3.9e12, 0.02),
  ],
};

const INTRADAY_TIMES = ["2026-11-13T14:40:00Z", "2026-11-13T14:45:00Z", "2026-11-13T14:50:00Z"];
const path = (values: number[]) => values.map((value, index) => ({ time: INTRADAY_TIMES[index], value }));
function series(previousClose: number, closes: number[], delayed: boolean | null): DeskIntradaySeries {
  let turnover = 0, volume = 0;
  const bars = closes.map((close, index) => {
    turnover += close * 1000;
    volume += 1000;
    return { end: INTRADAY_TIMES[index], o: close - 0.1, h: close + 0.5, l: close - 0.5, c: close, v: 1000, vwap: turnover / volume };
  });
  return { bars, previousClose, vwap: bars.at(-1)?.vwap ?? null, openGap: bars.length ? bars[0].o / previousClose - 1 : null, delayed, splitAdjusted: false };
}

export const INTRADAY_COMPANY: DeskIntradayResponse = {
  schemaVersion: 1, ticker: "AAPL", cik: 320193, name: "Apple Inc.", sector: "Information Technology", sectorFund: "XLK", requestedSessions: 1,
  status: "ok", session: "2026-11-13", asOf: "2026-11-13T14:50:00Z", marketOpen: false, delayed: true,
  sessions: [{
    date: "2026-11-13", company: series(354.88, [359.88, 360.25, 360.5], true), spy: series(757.12, [756.86, 757.1, 757.2], false), sector: series(173.77, [170.28, 170.5, 170.6], false),
    markers: [
      { time: "2026-11-13T15:05:00.000Z", date: "2026-11-13", kind: "release", label: "Earnings release", accessionNo: "0000320193-26-000100", sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000100", precision: "second" },
      { time: null, date: "2026-11-13", kind: "8-K", label: "8-K · filing date only", accessionNo: "0000320193-26-000101", sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000101", precision: "day" },
    ],
  }],
};

const MARKET_SECTORS = Object.entries(SECTOR_NAME_BY_FUND).map(([ticker, name]) => ({ ticker, name, points: path([0, ticker === "XLK" ? 0.01 : 0.001, ticker === "XLK" ? 0.02 : 0.002]), change: ticker === "XLK" ? 0.02 : 0.002 }));
export const INTRADAY_MARKET: DeskIntradayMarket = {
  schemaVersion: 1, generatedAt: "2026-11-13T14:50:01Z", session: "2026-11-13", asOf: "2026-11-13T14:50:00Z", marketOpen: false, delayed: true, status: "ok",
  coverage: { expected: 3, measured: 3 },
  breadth: [{ time: INTRADAY_TIMES[0], above: 2, measured: 3, share: 2 / 3 }, { time: INTRADAY_TIMES[1], above: 2, measured: 3, share: 2 / 3 }, { time: INTRADAY_TIMES[2], above: 2, measured: 3, share: 2 / 3 }],
  spy: { points: path([0, 0.001, 0.002]), change: 0.002 },
  equalWeight: { points: path([0, 0.002, 0.003]), change: 0.003 },
  sectors: MARKET_SECTORS,
  movers: [{ ticker: "AAPL", name: "Apple Inc.", points: path([0, 0.01, 0.02]), change: 0.02 }, { ticker: "NVDA", name: "Nvidia", points: path([0, -0.01, -0.02]), change: -0.02 }],
  paths: {
    AAPL: path([0, 0.01, 0.02]), NVDA: path([0, -0.01, -0.02]), MSFT: path([0, 0.005, 0.015]), SPY: path([0, 0.001, 0.002]),
    ...Object.fromEntries(MARKET_SECTORS.map(row => [row.ticker, row.points])),
  },
};

const evidence = (value: number | null) => ({ value, periodEnd: "2026-09-26", quality: value === null ? "missing" : "available", stale: false });

/** Minimal copies of the classic report files the research tools read. */
const REPORTS: Record<string, unknown> = {
  "daily-operations.json": {
    generatedAt: "2026-11-12T00:00:00.000Z",
    date: "2026-11-12",
    status: "ok",
    scheduler: { status: "ok", heartbeatAt: "2026-11-12T00:00:00.000Z", currentJobId: null, queuedJobs: 0, nextRunAt: null, enabledJobs: 1 },
    schwab: { status: "ok", tickersExpected: 50, tickersCompleted: 50, tickersCapturedToday: 50, manifestErrors: 0, latestCapture: "2026-11-12T00:00:00.000Z" },
    summary: { checksOk: 1, checksWarning: 0, checksError: 0, checksPending: 0, jobsDoneToday: 1, jobsFailedToday: 0, jobsEnabled: 1 },
    checks: [],
    jobs: [],
  },
  "weekly-coverage.json": {
    generatedAt: "2026-11-10T05:53:29.933Z", baselineGeneratedAt: "2026-11-03T05:50:00.000Z", status: "ready",
    summary: { tables: 3, tablesPresent: 2, tablesMissing: 1, tablesWithRowIncrease: 1, tablesWithRowDecrease: 0, tablesWithHashDrift: 1, rows: 84_825, baselineRows: 84_789, deltaRows: 36 },
    tables: [
      { table: "companies", present: true, baselinePresent: true, rows: 496, baselineRows: 496, deltaRows: 0, hashChanged: false, maxDate: null },
      { table: "signals", present: true, baselinePresent: true, rows: 84_329, baselineRows: 84_293, deltaRows: 36, hashChanged: true, maxDate: "2026-11-10" },
      { table: "option_chains", present: false, baselinePresent: false, rows: null, baselineRows: null, deltaRows: null, hashChanged: false, maxDate: null },
    ],
  },
  "data-health.json": {
    generatedAt: "2026-11-12T00:00:00.000Z",
    status: "complete",
    health: "degraded",
    summary: { checks: 10, findings: 23, info: 8, review: 4, quarantine: 11 },
  },
  "company-exposures.json": {
    generatedAt: "2026-11-11T11:18:47.607Z",
    coverage: { companies: 1, debt: 1 },
    companies: [{ cik: 320193, ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology", debt: evidence(78_114_000_000), debtToOperatingIncome: evidence(0.494), cashToDebt: evidence(0.4) }],
  },
  "macro-scenarios.json": {
    generatedAt: "2026-11-11T20:13:38.854Z",
    scenarios: [{ channel: "rates", shock: 0.01, baseline: { seriesId: "DGS10", value: 4.84, scenarioValue: 5.84, unit: "Percent", observationPeriod: "2026-11-05" }, impacts: [{ ticker: "AAPL", status: "computable", metrics: [] }, { ticker: "NVDA", status: "historical_only", metrics: [] }] }],
  },
};

/** What desk.opsHealth answers (no alerts unless a test sets some). */
export const OPS_HEALTH: { alerts: { level: "error" | "warning"; code: string; text: string }[] } = { alerts: [] };
export const DESK_DATA = { empty: false, unread: 0, noStatements: false };
/** The local worker console as the server reports it: its switch, and the scheduler's state and job switches. */
export const OPS_CONSOLE = { enabled: true };
const OPS_RUN = (jobId: string, over: Record<string, unknown> = {}) => ({ runId: `r-${jobId}`, jobId, status: "done", trigger: "cron", startedAt: "2026-11-12T00:45:00.000Z", endedAt: "2026-11-12T00:52:00.000Z", exitCode: 0, logFile: "x.log", error: null, ...over });
const OPS_STATE = {
  schemaVersion: 1, schedulerStartedAt: "2026-11-11T08:00:00.000Z", heartbeatAt: "2026-11-12T00:59:45.000Z",
  current: OPS_RUN("edgar-fetch-daily", { status: "running", endedAt: null, exitCode: null, startedAt: "2026-11-12T00:55:00.000Z" }),
  queue: [{ jobId: "edgar-exhibits-daily", trigger: "cron" }],
  nextRuns: { "schwab-fetch-daily": "2026-11-13T00:45:00.000Z", "facts-fetch-daily": "2026-11-12T11:00:00.000Z" },
  configuredCrons: {}, commandOffset: 0,
  lastRuns: {
    "schwab-fetch-daily": OPS_RUN("schwab-fetch-daily"),
    "schwab-snapshot": OPS_RUN("schwab-snapshot", { trigger: "dependency", startedAt: "2026-11-12T00:52:10.000Z", endedAt: "2026-11-12T00:52:40.000Z" }),
    "facts-fetch-daily": OPS_RUN("facts-fetch-daily", { status: "error", exitCode: 1, error: "The local web server on port 3000 did not answer", startedAt: "2026-11-11T11:00:00.000Z", endedAt: "2026-11-11T11:00:20.000Z" }),
    "edgar-fetch-daily": OPS_RUN("edgar-fetch-daily", { status: "running", endedAt: null, exitCode: null, startedAt: "2026-11-12T00:55:00.000Z" }),
  },
};

const CONTACTS = [
  { id: 2, username: "member", name: "Member One", role: "user", lastSignInAt: "2026-11-12", unread: 2, lastMsgAt: "2026-11-13T10:00:00", lastActivityAt: "2026-11-13T11:00:00" },
  { id: 3, username: "admin2", name: "Admin Two", role: "admin", lastSignInAt: "2026-11-12", unread: 0, lastMsgAt: "2026-11-12T10:00:00", lastActivityAt: "2026-11-12T11:00:00" },
  { id: 4, username: "other", name: "Other Account", role: "user", lastSignInAt: null, unread: 0, lastMsgAt: null, lastActivityAt: null },
];
const THREAD = [
  { id: 11, authorId: 2, recipientId: 1, body: "Could we review the filing?", createdAt: "2026-11-13T10:00:00", readAt: null },
  { id: 12, authorId: 1, recipientId: 2, body: "I will open it now.", createdAt: "2026-11-13T10:01:00", readAt: null },
];
const MANUALS = [
  { id: "engine-manual-en", title: "Engine Manual (EN)", bundledAt: "2026-11-13" },
  { id: "engine-manual-ru", title: "Engine Manual (RU)", bundledAt: "2026-11-13" },
  { id: "llm-context", title: "LLM Context", bundledAt: "2026-11-13" },
  { id: "design-value-signals", title: "Design: Value & Signals", bundledAt: "2026-11-13" },
];

const COMPANY_STATEMENTS = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", name: "Apple Inc.", standard: "v3.1", standardGeneratedAt: "2026-11-13T11:58:15.693Z", builtAt: "2026-11-22T00:00:00.000Z",
  quarters: [
    { end: "2026-06-27", fy: 2026, fq: 3, form: "10-Q", filed: "2026-07-31" },
    { end: "2026-09-26", fy: 2026, fq: 4, form: "10-K", filed: "2026-11-03" },
  ],
  statements: {
    income: [
      { code: "revenue", label: "Revenue", kind: "flow", cells: [{ value: 94_036_000_000, filed: "2026-07-31", source: "Revenues", restated: { value: 94_100_000_000, filed: "2026-11-03" } }, { value: 114_477_000_000, filed: "2026-11-03", source: "Revenues" }] },
      { code: "epsDil", label: "Diluted earnings per share", kind: "perShare", cells: [null, { value: 1.85, filed: "2026-11-03", source: "derived" }] },
      { code: "eps", label: "Earnings per basic share", kind: "perShare", cells: [{ value: 7.6, filed: "2026-07-31", source: "EarningsPerShareBasic", factor: 4 }, { value: 1.86, filed: "2026-11-03", source: "EarningsPerShareBasic" }] },
      { code: "shareswaDil", label: "Weighted average diluted shares", kind: "shares", cells: [{ value: 14_800, filed: "2026-07-31", source: "WeightedAverageNumberOfDilutedSharesOutstanding", suspect: true }, { value: 14_750_000_000, filed: "2026-11-03", source: "WeightedAverageNumberOfDilutedSharesOutstanding" }] },
    ],
    balance: [{ code: "totalAssets", label: "Total assets", kind: "instant", cells: [null, { value: 359_241_000_000, filed: "2026-11-03", source: "Assets" }] }],
    cashflow: [],
  },
  years: [{ end: "2026-09-26", fy: 2026, filed: "2026-11-03", quarter: 1 }],
  annual: {
    income: [{ code: "revenue", cells: [{ value: 478_834_000_000, restated: 479_000_000_000 }] }, { code: "epsDil", cells: [{ value: 8.31, ratio: true }] }],
    balance: [], cashflow: [],
  },
  trailing: {
    income: [{ code: "revenue", cells: [{ value: 466_823_000_000 }, { value: 478_834_000_000, restated: 479_000_000_000 }] }, { code: "epsDil", cells: [null, { value: 8.31, ratio: true }] }],
    balance: [], cashflow: [],
  },
};

const COMPANY_GUIDANCE = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", guidanceVersion: "g1.2.20261122", standard: "v3.1", builtAt: "2026-11-22T00:00:00.000Z",
  periods: [
    { metric: "revenue", basis: "unclear", kind: "Q", periodEnd: "2026-12-26", fy: null, fq: null, updates: [{ issued: "2026-10-30", low: 120e9, high: 126e9, mid: 123e9 }], reaffirmed: 0, actual: null, note: "not_reported_yet" },
    { metric: "revenue", basis: "unclear", kind: "Q", periodEnd: "2026-09-26", fy: 2026, fq: 4, updates: [{ issued: "2026-07-31", low: 108e9, high: 112e9, mid: 110e9 }], reaffirmed: 0, actual: { value: 114_477_000_000, filed: "2026-11-03", how: "quarter" }, note: null },
    { metric: "revenue", basis: "unclear", kind: "FY", periodEnd: "2025-09-27", fy: 2025, fq: null, updates: [{ issued: "2025-01-30", low: null, high: null, mid: 400e9 }, { issued: "2025-07-31", low: null, high: null, mid: 410e9 }], reaffirmed: 1, actual: { value: 405e9, filed: "2025-10-31", how: "four_quarters" }, note: null },
    { metric: "eps", basis: "non_gaap", kind: "Q", periodEnd: "2026-09-26", fy: 2026, fq: 4, updates: [{ issued: "2026-07-31", low: 1.7, high: 1.8, mid: 1.75 }], reaffirmed: 0, actual: null, note: "adjusted_basis" },
    { metric: "eps", basis: "non_gaap", kind: "Q", periodEnd: "2026-06-27", fy: 2026, fq: 3, updates: [{ issued: "2026-05-01", low: 1.45, high: 1.55, mid: 1.5 }], reaffirmed: 0, actual: { value: 1.62, filed: "2026-07-31", how: "release" }, note: null },
  ],
};
const COMPANY_ACTIONS = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", pricesAsOf: "2026-11-20", lastClose: 342.845, builtAt: "2026-11-22T00:00:00.000Z",
  splits: [{ date: "2020-08-31", ratio: 4 }, { date: "2014-06-09", ratio: 7 }], distributions: [],
  dividends: [{ date: "2026-11-12", amount: 0.27 }, { date: "2026-08-10", amount: 0.27 }, { date: "2026-05-11", amount: 0.27 }, { date: "2026-02-09", amount: 0.26 }],
  dividendsLastYear: 1.07,
};
// eleven closes: up to a high, a fall of a fifth, a partial recovery
const PRICE_HISTORY = {
  source: "test",
  bars: [100, 102, 104, 110, 99, 88, 90, 92, 91, 95, 96.8].map((close, index) => ({ date: `2026-11-${String(index + 2).padStart(2, "0")}`, close, volume: 1_000_000 })),
};
const COMPANY_FILINGS = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", asOf: "2026-11-05", builtAt: "2026-11-22T00:00:00.000Z",
  filings: [
    { accession: "0000320193-26-000101", form: "10-K", filed: "2026-11-03", acceptedEt: "2026-11-03T06:01:00", period: "2026-09-26", items: [], earnings: false, primaryDoc: "aapl-20260926.htm", exhibits: [] },
    { accession: "0000320193-26-000099", form: "8-K", filed: "2026-10-29", acceptedEt: "2026-10-29T16:30:12", period: "2026-10-29", items: ["2.02", "9.01"], earnings: true, primaryDoc: "aapl-8k.htm", exhibits: ["000032019326000099.ex-a8kex991.htm", "000032019326000099.ex-slides.htm"] },
    { accession: "0000320193-26-000080", form: "8-K", filed: "2026-09-10", acceptedEt: null, period: "2026-09-09", items: ["5.02", "7.77"], earnings: false, primaryDoc: null, exhibits: [] },
    ...Array.from({ length: 11 }, (_, index) => ({ accession: `0000320193-25-0000${String(40 - index).padStart(2, "0")}`, form: "10-Q", filed: `2025-${String(12 - index).padStart(2, "0")}-01`, acceptedEt: null, period: `2025-${String(12 - index).padStart(2, "0")}-01`, items: [], earnings: false, primaryDoc: "q.htm", exhibits: [] })),
  ],
};
const COMPANY_HOLDERS = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", version: "k16.5", builtAt: "2026-11-22T00:00:00.000Z",
  quarters: [
    { period: "2026-03-31", knownAt: "2026-06-02", holders: 264, fundsFiled: 303, fundsInBook: 303, valueUsd: 2.025e12, shareOfStock: 0.5444, entries: 7, exits: 3, continuing: 284, breadthChange: 0.0141, sharesBought: 173e6, sharesSold: 107e6, top10Share: 0.5725 },
    { period: "2026-06-30", knownAt: "2026-08-31", holders: 270, fundsFiled: 307, fundsInBook: 307, valueUsd: 2.425e12, shareOfStock: 0.5747, entries: 6, exits: 5, continuing: 294, breadthChange: 0.0034, sharesBought: 309.2e6, sharesSold: 124.3e6, top10Share: 0.5548 },
  ],
};
/** The Screener's fundamentals: Apple with every figure, Nvidia with a loss, Microsoft without a row (Schwab's figures stand in). */
const SCREEN = {
  schemaVersion: 2, standard: "v3.2", pricesAsOf: "2026-11-20", builtAt: "2026-11-23T00:00:00.000Z",
  companies: [
    { cik: 320193, ticker: "AAPL", periodEnd: "2026-09-26", filed: "2026-11-03", revenue: 400e9, revenueYearAgo: 320e9, netIncome: 100e9, freeCashFlow: 80e9, epsDiluted: 5, epsHow: "year", dollarVolume: 14.6e9 },
    { cik: 1045810, ticker: "NVDA", periodEnd: "2026-10-25", filed: "2026-11-18", revenue: 200e9, revenueYearAgo: null, netIncome: -10e9, freeCashFlow: null, epsDiluted: -2, epsHow: "last_shares", dollarVolume: 33.3e9 },
  ],
};

const INSIDER_MARKET = {
  schemaVersion: 2, version: "i-test", asOf: "2026-11-13", builtAt: "2026-11-23T00:00:00Z", companies: 500, days: 90,
  totals: { bought: 12_400_000, sold: 2_100_000_000, buyers: 14, sellers: 610, buyingCompanies: 9, sellingCompanies: 302, soldUnderPlan: 1_470_000_000 },
  purchases: [
    { cik: 1045810, ticker: "NVDA", date: "2026-11-02", filed: "2026-11-04", accession: "0000050863-26-000195", owner: "TAN LIP BU", more: 0, role: "Chief Executive Officer", shares: 150_000, price: 64.73, valueUsd: 9_709_500 },
    { cik: 320193, ticker: "AAPL", date: "2026-10-20", filed: "2026-10-22", accession: "0001596532-26-000260", owner: "LEVINSON ARTHUR D", more: 1, role: "Director", shares: 1000, price: 250, valueUsd: 250_000 },
  ],
  windows: [{ cik: 789019, ticker: "MSFT", start: "2026-08-10", end: "2026-08-12", insiders: 3, valueUsd: 1_500_000, roles: ["Chief Executive Officer", "Director"] }],
  netBuyers: [{ cik: 1045810, ticker: "NVDA", bought: 9_709_500, sold: 0, buyers: 1, sellers: 0, soldUnderPlan: 0 }],
  netSellers: [{ cik: 320193, ticker: "AAPL", bought: 250_000, sold: 126_000_000, buyers: 1, sellers: 11, soldUnderPlan: 126_000_000 }],
};

const COMPANY_INSIDERS = {
  schemaVersion: 2, cik: 320193, ticker: "AAPL", version: "i1.1.20261116", asOf: "2026-11-13", builtAt: "2026-11-22T00:00:00.000Z",
  trades: [
    { date: "2026-10-01", filed: "2026-10-03", owner: "COOK TIMOTHY D", more: 0, role: "Chief Executive Officer", code: "S", shares: 100_000, price: 250, valueUsd: 25_000_000, plan: true },
    { date: "2026-10-01", filed: "2026-10-03", owner: "COOK TIMOTHY D", more: 0, role: "Chief Executive Officer", code: "F", shares: 50_000, price: 250, valueUsd: 12_500_000, plan: false },
    { date: "2026-08-10", filed: "2026-08-12", owner: "LEVINSON ARTHUR D", more: 1, role: "Director", code: "P", shares: 2_000, price: 230, valueUsd: 460_000, plan: false },
    { date: "2026-05-04", filed: "2026-05-05", owner: "SEQUOIA CAPITAL FUND", more: 0, role: "10% owner", code: "S", shares: 10_000, price: 900, valueUsd: null, plan: false },
    ...Array.from({ length: 9 }, (_, index) => ({ date: `2026-03-${String(20 - index).padStart(2, "0")}`, filed: "2026-03-21", owner: "MAESTRI LUCA", more: 0, role: "Chief Financial Officer", code: "A", shares: 1_000 + index, price: null, valueUsd: null, plan: false })),
  ],
  tradeCount: 13, marketCount: 3,
  quarters: [
    ...["2022-03-31", "2022-06-30", "2022-09-30", "2022-12-31", "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
      .map((quarter) => ({ quarter, bought: 0, sold: 0, buyers: 0, sellers: 0 })),
    { quarter: "2026-06-30", bought: 0, sold: 9_000_000, buyers: 0, sellers: 1 },
    { quarter: "2026-09-30", bought: 460_000, sold: 0, buyers: 1, sellers: 0 },
    { quarter: "2026-12-31", bought: 0, sold: 25_000_000, buyers: 0, sellers: 1 },
  ],
  year: { bought: 460_000, sold: 34_000_000, buyers: 1, sellers: 2, soldUnderPlan: 25_000_000 },
};

function answer(procedure: string, role: string): unknown {
  const owner = role === "admin";
  switch (procedure) {
    case "desk.opsHealth": return { checkedAt: "2026-11-12T20:00:00.000Z", heartbeatAt: "2026-11-12T20:00:00.000Z", alerts: OPS_HEALTH.alerts };
    case "auth.me": return { id: 1, username: "owner", name: "Ada Owner", role };
    case "reviewer.status": return { isReviewer: false, ndaAccepted: false, ndaVersion: null, ndaTextHash: null, firstIpBound: false, tours: [] };
    case "desk.snapshot": return SNAPSHOT;
    case "desk.intraday": return DESK_DATA.empty ? null : INTRADAY_COMPANY;
    case "desk.intradayMarket": return DESK_DATA.empty ? null : INTRADAY_MARKET;
    case "messages.unreadCount": return { count: DESK_DATA.unread };
    case "messages.contacts": return DESK_DATA.empty ? [] : CONTACTS.filter((contact) => owner || contact.id !== 4).map((contact) => owner ? contact : { id: contact.id, username: contact.username, name: contact.name, unread: contact.unread, lastMsgAt: contact.lastMsgAt });
    case "messages.list": return { withUserId: 2, rows: DESK_DATA.empty ? [] : THREAD };
    case "messages.send": return { ok: true, id: 101 };
    case "messages.markRead": return { ok: true };
    case "activity.track": return { ok: true };
    case "universe.list": return { rows: [{ cik: 320193, ticker: "AAPL", name: "Apple Inc." }], total: 1 };
    case "dashboard.latestFilings": return [];
    case "dashboard.macro": return [{ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-05", value: 4.12 }];
    case "dashboard.sectorFlowsDetailed": return { rows: [{ sector: "Information Technology", deltaUsd: 12e9, curUsd: 900e9, deltaShares: 1e6, curShares: 9e9, deltaWeightPp: 0.42 }], guard: null };
    case "universe.add": case "universe.remove": return { ok: true };
    case "desk.flowsOverview": return FLOWS_OVERVIEW;
    case "desk.flowsFund": return FLOWS_FUND;
    case "desk.flowsCompany": return FLOWS_COMPANY;
    case "desk.companyStatements": return DESK_DATA.empty || DESK_DATA.noStatements ? null : COMPANY_STATEMENTS;
    case "desk.companyGuidance": return DESK_DATA.empty || DESK_DATA.noStatements || !owner ? null : COMPANY_GUIDANCE;
    case "prices.history": return DESK_DATA.empty ? null : PRICE_HISTORY;
    case "desk.companyActions": return DESK_DATA.empty || DESK_DATA.noStatements ? null : COMPANY_ACTIONS;
    case "desk.companyFilings": return DESK_DATA.empty || DESK_DATA.noStatements ? null : COMPANY_FILINGS;
    case "desk.companyDocument": return DESK_DATA.empty ? null : { accession: "0000320193-26-000099", file: "000032019326000099.ex-a8kex991.htm", paragraphs: ["Apple reports fourth quarter results", "Revenue | $114.5 billion"], truncated: false };
    case "desk.companyHolders": return DESK_DATA.empty || DESK_DATA.noStatements ? null : COMPANY_HOLDERS;
    case "workersLocal.enabled": return { enabled: OPS_CONSOLE.enabled };
    case "workersLocal.operations": return { config: { "stocktwits-hourly": { enabled: false, cron: "30 * * * *" } }, state: OPS_STATE };
    case "workersLocal.setOperation": case "workersLocal.killOperation": return { ok: true };
    case "workersLocal.runOperation": return { id: "1-schwab-snapshot", chain: ["schwab-fetch-daily", "schwab-snapshot"] };
    case "workersLocal.operationLog": return { lines: ["[edgar] 412 of 503 companies", "[edgar] waiting 0.2 s"] };
    case "desk.insiderMarket": return DESK_DATA.empty ? null : INSIDER_MARKET;
    case "desk.screen": return DESK_DATA.empty ? null : SCREEN;
    case "desk.companyInsiders": return DESK_DATA.empty || DESK_DATA.noStatements ? null : COMPANY_INSIDERS;
    case "desk.engineIndex": return ENGINE_INDEX;
    case "desk.engineCompany": return ENGINE_COMPANY;
    case "admin.usersList": return DESK_DATA.empty ? [] : [
      { id: 1, username: "owner", name: "Ada Owner", role: "admin", universeSize: 50, lastSignInAt: "2026-11-13", createdAt: "2026-01-01" },
      { id: 2, username: "member", name: "Member One", role: "user", universeSize: 3, lastSignInAt: "2026-11-12", createdAt: "2026-02-01" },
    ];
    case "admin.userSummary": return { user: { id: 2, username: "member", name: "Member One", role: "user", createdAt: "2026-02-01", lastSignInAt: "2026-11-12" }, universeSize: 3, universeActive: 2, messagesSent: 8, jobsLaunched: 2, activity: { logins7d: 4, pages24h: 17, totalEvents: 120, lastLoginAt: "2026-11-12", lastSeenAt: "2026-11-13" } };
    case "admin.userActivity": return [{ id: 1, type: "page", path: "/desk", createdAt: "2026-11-13T10:00:00" }];
    case "admin.reviewerList": return DESK_DATA.empty ? [] : [{ userId: 5, username: "reviewer", name: "Review Reader", ndaAccepted: true, acceptedAt: "2026-11-04T12:00:00", firstIpBound: true, universeSize: 50, tours: [{ track: "geography", currentStep: 2, status: "completed" }, { track: "technical", currentStep: 0, status: "not_started" }] }];
    case "admin.manuals": return DESK_DATA.empty ? [] : MANUALS;
    case "admin.manualContent": return { id: "engine-manual-en", title: "Engine Manual (EN)", source: "disk", updatedAt: "2026-11-13", content: "# Manual heading\n\nA **bold** statement with [evidence](https://www.sec.gov/).\n\n| Field | Value |\n|---|---|\n| Prices | 2,000 |\n\n```ts\nconst answer = 42;\n```" };
    case "admin.recentJobs": return DESK_DATA.empty ? [] : [{ id: 55, type: "prices", status: "done", params: "{}", message: "done", createdAt: "2026-11-13T09:00:00", finishedAt: "2026-11-13T09:01:00", startedBy: 1, startedByName: "Ada Owner" }];
    case "admin.jobLog": return { lines: [{ id: 1, ts: "2026-11-13T09:01:00", level: "info", message: "Price load finished" }], truncated: false };
    case "admin.factorIc": return DESK_DATA.empty ? [] : [{ factor: "assetGrowth", horizon: 63, quarter: "2026Q1", spearman: 0.12, n: 10 }];
    case "workersMonitor.intake": return DESK_DATA.empty ? { perSource: [], recent: [], keys: [] } : {
      perSource: [{ source: "stocktwits", rows_total: 12, liveRows: 10, backfillRows: 2, lastEventTs: "2026-11-13T10:00:00", lastIngestedAt: "2026-11-13T10:01:00" }],
      keys: [{ id: 1, label: "home", revokedAt: null, lastUsedAt: "2026-11-13T10:01:00", createdAt: "2026-01-01" }],
      recent: [{ cik: 320193, ticker: "AAPL", source: "edgar", signalType: "tone", eventTs: "2026-11-13T10:00:00", ingestedAt: "2026-11-13T10:01:00", score: 0.2, magnitude: 12, src: "live", note: "Full worker note evidence.", payloadKey: "llm:model:edgar:320193:0000320193-26-000001" }],
    };
    case "admin.createUser": return { ok: true, id: 99 };
    case "admin.createReviewer": return { ok: true, userId: 99 };
    case "admin.deleteUser": case "admin.resetPassword": case "admin.setUserRole": return { ok: true };
    case "admin.resetReviewerFirstIp": case "admin.resetReviewerNda": case "admin.resetReviewerTour": return { ok: true };
    default: return null;
  }
}

/**
 * Polls in short act() slices: React flushes the work queued inside an async act (a lazy page resolving, query
 * results) only when that act ends, so one long act around a wait would hold the page back until it times out.
 */
export async function waitUntil(condition: () => boolean, timeout = 4000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error(`Condition not met within ${timeout} ms`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

export interface MountedDesk {
  host: HTMLDivElement;
  calls: string[];
  unmount: () => void;
}

export async function mountDesk(role: "admin" | "user", path = "/desk", ready = "S&P 500 companies closed higher", application = false): Promise<MountedDesk> {
  // load the lazy pages up front so the test waits on data, not on the module loader
  await Promise.all([
    import("./pages/Today"), import("./pages/Watchlist"), import("./pages/research/Signals"), import("./pages/research/Earnings"),
    import("./pages/research/Volatility"), import("./pages/research/Macro"), import("./pages/research/Ownership"), import("./pages/research/Library"),
    import("./flows/FlowsPage"), import("./pages/Messages"), import("./pages/Admin"), import("./pages/Operations"),
  ]);
  const Application = application ? (await import("@/App")).default : null;
  // jsdom has neither; the palette (cmdk) needs both to mount
  Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
    if (url.pathname.startsWith("/reports/")) {
      const name = url.pathname.replace("/reports/", "");
      calls.push(`report:${name}`);
      return { ok: name in REPORTS, status: name in REPORTS ? 200 : 404, json: async () => REPORTS[name] } as Response;
    }
    const procedures = decodeURIComponent(url.pathname.replace("/api/trpc/", "")).split(",");
    calls.push(...procedures);
    return { ok: true, status: 200, json: async () => procedures.map((procedure) => ({ result: { data: { json: answer(procedure, role) } } })) } as Response;
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: ReturnType<typeof createRoot> | null = null;
  act(() => {
    root = createRoot(host);
    root.render(
      <TRPCProvider>
        <MemoryRouter initialEntries={[path]}>
          {Application ? <Application /> : <Routes><Route path="/desk/*" element={<DeskApp />} /></Routes>}
        </MemoryRouter>
      </TRPCProvider>,
    );
  });
  await waitUntil(() => (host.textContent ?? "").includes(ready), 8000);
  return {
    host,
    calls,
    unmount: () => {
      act(() => root?.unmount());
      host.remove();
      globalThis.fetch = originalFetch;
    },
  };
}
