// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchwabContext from "./SchwabContext";

const start = Date.parse("2026-10-30T13:30:00Z");
const bars = Array.from({ length: 7 }, (_, index) => ({ datetime: start + index * 300000, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 100 }));
const report = {
  schemaVersion: 1, generatedAt: "2026-10-31T12:00:00Z", provider: "schwab",
  coverage: { expected: 8, complete: 8, errors: 0 },
  hours: {
    equity: { date: "2026-10-31", isOpen: true, isHoliday: false, regularMarket: [{ start: "2026-10-31T09:30:00-04:00", end: "2026-10-31T16:00:00-04:00" }] },
    option: { date: "2026-10-31", isOpen: false, isHoliday: true, regularMarket: [] },
  },
  movers: [{ index: "SPX", rows: [{ symbol: "AAPL", description: "Apple Inc", last: 200, change: 4, percentChange: 2, volume: 1000, direction: "up" }] }],
  instruments: [{ symbol: "AAPL", cusip: "037833100", description: "Apple Inc", exchange: "NASDAQ", assetType: "EQUITY", assetMainType: "EQUITY", fundamental: { marketCap: 1000, peRatio: 30 } }],
  intraday: [{ ticker: "AAPL", frequencyMinutes: 5, bars, vwap: 102, openingRangeHigh: 106, openingRangeLow: 99, lastClose: 106 }],
  files: [{ kind: "hours/equity", capturedAt: "2026-10-31T12:00:00Z", sourceHash: "abcdef123456", status: "complete" }],
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock;

describe("Schwab Market Context", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
    host = document.createElement("div"); document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<SchwabContext />); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

  it("renders sessions, movers, intraday metrics and instrument fundamentals", () => {
    expect(host!.textContent).toContain("8 / 8");
    expect(host!.textContent).toContain("Market movers");
    expect(host!.textContent).toContain("AAPL");
    expect(host!.textContent).toContain("+2.00%");
    expect(host!.textContent).toContain("VWAP");
    expect(host!.textContent).toContain("037833100");
    expect(host!.textContent).toContain("marketCap");
    expect(host!.textContent).toContain("Holiday");
  });
});
