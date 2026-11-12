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
  companies: [row("AAPL", "Apple Inc.", 320193, 5.1e12, 0.012), row("NVDA", "Nvidia", 1045810, 4.3e12, -0.0547), row("MSFT", "Microsoft", 789019, 3.9e12, 0.02)],
};

function answer(procedure: string, role: string): unknown {
  switch (procedure) {
    case "auth.me": return { id: 1, username: "owner", name: "Ada Owner", role };
    case "reviewer.status": return { isReviewer: false, ndaAccepted: false, ndaVersion: null, ndaTextHash: null, firstIpBound: false, tours: [] };
    case "desk.snapshot": return SNAPSHOT;
    case "messages.unreadCount": return { count: 0 };
    case "activity.track": return { ok: true };
    case "screener.table": return { rows: [{ cik: 320193, ticker: "AAPL", name: "Apple Inc.", price: 100, changePct: 0.012 }], asOf: "2026-11-10T20:00:00Z", fresh: true };
    case "dashboard.latestFilings": return [];
    case "dashboard.macro": return [{ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-05", value: 4.12 }];
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

export async function mountDesk(role: "admin" | "user", path = "/desk"): Promise<MountedDesk> {
  // load the lazy page up front so the test waits on data, not on the module loader
  await import("./pages/Today");
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
  await waitUntil(() => (host.textContent ?? "").includes("S&P 500 companies closed higher"), 8000);
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
