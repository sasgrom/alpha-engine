// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketData from "./MarketData";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const snapshot = {
    schemaVersion: 1,
    generatedAt: "2026-10-30T12:00:00Z",
    provider: "schwab",
    files: [{ ticker: "AAPL", file: "chains/2026-10-30/AAPL.json", sourceHash: "abcdef1234567890", status: "complete", capturedAt: "2026-10-30T12:00:00Z" }],
    coverage: { tickersExpected: 51, tickersCompleted: 1, endpointsComplete: 4, errors: 0, contracts: 2, expirations: 1, latestCapture: "2026-10-30T12:00:00Z", tokenExpiresAt: "2026-10-30T23:00:00Z", lastRefreshAt: "2026-10-30T12:00:00Z" },
    options: [
      { symbol: "AAPL 261030C00345000", osiId: "AAPL  261030C00345000", underlying: "AAPL", expiration: "2026-10-30", dte: 0, strike: 345, putCall: "CALL", bid: 2.1, ask: 2.2, last: 2.15, mark: 2.12, spread: 0.1, volume: 100, openInterest: 500, iv: 0.29, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.02, underlyingPrice: 344.9, delayed: false, sourceHash: "x", sourceStatus: "SUCCESS" },
      { symbol: "MSFT 261120C00100000", osiId: "MSFT  261120C00100000", underlying: "MSFT", expiration: "2026-11-20", dte: 21, strike: 100, putCall: "CALL", bid: 1, ask: 1.2, last: 1.1, mark: 1.1, spread: 0.2, volume: 10, openInterest: 20, iv: 0.4, delta: 0.4, gamma: 0.01, theta: -0.01, vega: 0.1, rho: 0.01, underlyingPrice: 200, delayed: false, sourceHash: "y", sourceStatus: "SUCCESS" },
    ],
    qa: { duplicateOsi: 0, zeroBid: 0, zeroAsk: 0, crossed: 0, invalidGreeks: 0, invalidIv: 0, manifestErrors: 0 },
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Schwab Market Data UI", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><MarketData /></MemoryRouter>); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

  it("shows real coverage, token metadata and provenance without secrets", () => {
    expect(host!.textContent).toContain("Schwab Market Data Production");
    expect(host!.textContent).toContain("1 / 51");
    expect(host!.textContent).toContain("2026-10-30");
    expect(host!.textContent).not.toContain("refresh_token");
    expect(host!.textContent).not.toContain("access_token");
  });

  it("filters contracts by underlying and opens provenance", async () => {
    const optionsTab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Options")!;
    await act(async () => { optionsTab.click(); });
    const select = host!.querySelector('select[aria-label="Filter underlying"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "AAPL");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host!.textContent).toContain("AAPL  261030C00345000");
    const provenanceTab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Provenance & QA")!;
    await act(async () => { provenanceTab.click(); });
    expect(host!.textContent).toContain("abcdef123456");
    expect(host!.textContent).toContain("Duplicate OSI");
  });
});
