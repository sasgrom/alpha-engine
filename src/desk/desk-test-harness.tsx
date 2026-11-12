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
import DeskApp from "./DeskApp";

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

const evidence = (value: number | null) => ({ value, periodEnd: "2026-09-26", quality: value === null ? "missing" : "available", stale: false });

/** Minimal copies of the classic report files the research tools read. */
const REPORTS: Record<string, unknown> = {
  "company-exposures.json": {
    generatedAt: "2026-11-11T11:18:47.607Z",
    coverage: { companies: 1, debt: 1 },
    companies: [{ cik: 320193, ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology", debt: evidence(78_114_000_000), debtToOperatingIncome: evidence(0.494), cashToDebt: evidence(0.4) }],
  },
  "macro-scenarios.json": {
    generatedAt: "2026-11-11T20:13:38.854Z",
    scenarios: [{ channel: "rates", shock: 0.01, baseline: { seriesId: "DGS10", value: 4.84, scenarioValue: 5.84, unit: "Percent", observationPeriod: "2026-11-05" }, impacts: [{ ticker: "AAPL", status: "computable", metrics: [] }, { ticker: "NVDA", status: "historical_only", metrics: [] }] }],
  },
  "insider-form4.json": {
    generatedAt: "2026-11-10T22:43:58.592Z",
    universe: 50,
    kpi: { openMarketBuyCount: 1238, openMarketBuyUsd: 2_943_972_302, uniqueInsidersBuying: 294 },
    transactions: [
      { accessionNo: "0000050863-26-000195", ticker: "NVDA", eventTs: "2026-11-02", transactionCode: "P", shares: 150_000, pricePerShare: 64.73, valueUsd: 9_709_680, rptOwnerName: "TAN LIP BU", isDirector: true, isOfficer: true, isTenPercentOwner: false, officerTitle: "CEO", sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000195/form4.xml" },
      { accessionNo: "0001596532-26-000260", ticker: "AAPL", eventTs: "2026-11-05", transactionCode: "S", shares: 8775, pricePerShare: 159.1, valueUsd: 1_396_161, rptOwnerName: "SELLER SAM", isDirector: false, isOfficer: false, isTenPercentOwner: true, officerTitle: null, sourceUrl: null },
    ],
    clusters: [{ clusterId: "c1", ticker: "MSFT", windowStart: "2026-08-10", windowEnd: "2026-08-12", uniqueInsidersExcludingMultiOwner: 3, aggregatePurchaseUsd: 1_500_000, hasCeo: true, hasCfo: false, hasDirector: true, flipAfterSell90d: false }],
    benchmarkRuns: [{ methodologyStatus: "canonical", horizons: { forward5d: { hitRate: 0.556, medianExcess: 0.00378, counts: { computed: 534 } }, forward20d: { hitRate: 0.513, medianExcess: 0.00291, counts: { computed: 519 } } } }],
  },
};

function answer(procedure: string, role: string): unknown {
  switch (procedure) {
    case "auth.me": return { id: 1, username: "owner", name: "Ada Owner", role };
    case "reviewer.status": return { isReviewer: false, ndaAccepted: false, ndaVersion: null, ndaTextHash: null, firstIpBound: false, tours: [] };
    case "desk.snapshot": return SNAPSHOT;
    case "messages.unreadCount": return { count: 0 };
    case "activity.track": return { ok: true };
    case "universe.list": return { rows: [{ cik: 320193, ticker: "AAPL", name: "Apple Inc." }], total: 1 };
    case "dashboard.latestFilings": return [];
    case "dashboard.macro": return [{ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-05", value: 4.12 }];
    case "dashboard.sectorFlowsDetailed": return { rows: [{ sector: "Information Technology", deltaUsd: 12e9, curUsd: 900e9, deltaShares: 1e6, curShares: 9e9, deltaWeightPp: 0.42 }], guard: null };
    case "universe.add": case "universe.remove": return { ok: true };
    case "admin.usersList": return [];
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

export async function mountDesk(role: "admin" | "user", path = "/desk", ready = "S&P 500 companies closed higher"): Promise<MountedDesk> {
  // load the lazy pages up front so the test waits on data, not on the module loader
  await Promise.all([
    import("./pages/Today"), import("./pages/Watchlist"), import("./pages/research/Signals"), import("./pages/research/Earnings"),
    import("./pages/research/Volatility"), import("./pages/research/Macro"), import("./pages/research/Ownership"), import("./pages/research/Library"),
  ]);
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
          <Routes>
            <Route path="/desk/*" element={<DeskApp />} />
          </Routes>
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
