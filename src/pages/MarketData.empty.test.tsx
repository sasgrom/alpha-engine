// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketData from "./MarketData";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/data/schwab-market-data", () => ({
  schwabMarketSnapshot: {
    schemaVersion: 1,
    generatedAt: "2026-10-30T12:00:00Z",
    provider: "schwab",
    files: [],
    coverage: { tickersExpected: 51, tickersCompleted: 0, endpointsComplete: 0, errors: 0, contracts: 0, expirations: 0, latestCapture: null, tokenExpiresAt: null, lastRefreshAt: null },
    options: [],
    qa: { duplicateOsi: 0, zeroBid: 0, zeroAsk: 0, crossed: 0, invalidGreeks: 0, invalidIv: 0, manifestErrors: 0 },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Schwab Market Data empty state", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><MarketData /></MemoryRouter>); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("shows the real empty snapshot and exact collection commands", () => {
    expect(host!.textContent).toContain("No Schwab snapshots yet");
    expect(host!.textContent).toContain("npx tsx worker/schwab-fetch.mts --universe research-universe-51.json");
    expect(host!.textContent).toContain("npx tsx worker/build-schwab-market-data.mts");
    expect(host!.textContent).toContain("0 / 51");
  });
});
