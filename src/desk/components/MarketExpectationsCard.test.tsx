// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PredictionExpectationsReport } from "@contracts/prediction-markets";
import MarketExpectationsCard, { PredictionExpectationsCard } from "./MarketExpectationsCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-11-14T00:00:00.000Z");
const report: PredictionExpectationsReport = {
  schemaVersion: 1,
  generatedAt: NOW.toISOString(),
  asOf: NOW.toISOString(),
  status: "ok",
  closed: false,
  fed: {
    meeting: "2026-12-09T19:00:00Z", alternateMeeting: "2026-12-09T19:00:00Z", currentUpper: 4,
    expectedUpper: { primary: 3.85, alternate: null },
    outcomes: {
      cut: { primary: 0.15, alternate: 0.3 },
      unchanged: { primary: 0.63, alternate: 0.55 },
      hike: { primary: 0.22, alternate: 0.15 },
    },
    next: [{ meeting: "2026-12-09T19:00:00Z", expected: 3.85 }],
  },
  cpi: { event: "KXCPI-26NOV", expected: { primary: 0.3, alternate: 0.31 }, spread: { primary: 0.1, alternate: 0.11 } },
  recession: { event: "recession-2026", probability: { primary: 0.22, alternate: 0.19 } },
  calibration: { fed: "Fed markets: 0.99 skill the day before, 2022–2026", cpi: "CPI markets: 0.74 skill the day before, 2022–2026" },
  notes: [],
};

describe("prediction-market expectations card", () => {
  let root: ReturnType<typeof createRoot> | null = null, host: HTMLDivElement | null = null;
  function render(value: PredictionExpectationsReport | null, loading = false) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host!); root.render(<PredictionExpectationsCard report={value} loading={loading} now={NOW} />); });
  }
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    document.documentElement.className = "";
    vi.unstubAllGlobals();
  });

  it("renders both feeds, calibrated context and the as-of time without provider names", () => {
    render(report);
    expect(host!.textContent).toContain("What the market expects");
    expect(host!.textContent).toContain("Next listed Fed decision");
    expect(host!.textContent).toContain("3.85% expected upper bound");
    expect(host!.textContent).toContain("Next CPI expectation");
    expect(host!.textContent).toContain("Primary feed");
    expect(host!.textContent).toContain("Alternate feed");
    expect(host!.textContent).toContain("63.0%");
    expect(host!.textContent).toContain("55.0%");
    expect(host!.textContent).toContain("0.99 skill the day before");
    expect(host!.textContent).toContain("Nov 14, 2026");
    expect(host!.textContent).toContain("UTC");
    expect(host!.textContent).not.toMatch(/kalshi|polymarket/i);
    expect(host!.textContent).not.toContain("stale snapshot");
  });

  it("renders the empty and loading states", () => {
    render(null);
    expect(host!.textContent).toContain("No market expectations have been collected yet");
    const current = host;
    current!.remove();
    root = null;
    render(null, true);
    expect(host!.querySelector(".desk-shimmer")).not.toBeNull();
  });

  it("marks closed markets and stale data instead of presenting them as current", () => {
    render({ ...report, closed: true, status: "partial", asOf: "2026-11-10T00:00:00.000Z" });
    expect(host!.textContent).toContain("closed markets; last quotes, not current");
    expect(host!.textContent).toContain("stale snapshot");
    expect(host!.textContent).toContain("partial capture");
  });

  it("renders in light and dark themes", () => {
    for (const theme of ["light", "dark"]) {
      document.documentElement.className = theme;
      render(report);
      expect(host!.textContent).toContain("What the market expects");
      expect(host!.querySelector("section")!.className).toContain("desk-card");
      expect(document.documentElement.className).toBe(theme);
      act(() => root!.unmount());
      host!.remove();
      root = null;
      host = null;
    }
  });

  it("loads the report with no-store", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<QueryClientProvider client={client}><MarketExpectationsCard /></QueryClientProvider>);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/reports/prediction-markets.json", expect.objectContaining({ cache: "no-store", credentials: "include" }));
    expect(host!.textContent).toContain("What the market expects");
    client.clear();
  });
});
