// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchwabFeatureLab from "./SchwabFeatureLab";

const report = {
  schemaVersion: 1, generatedAt: "2026-10-31T12:01:00Z", provider: "schwab", sourceSnapshotSha256: "843ec5ec4eb7abcdef",
  coverage: { tickers: 1, contracts: 5, rv20Available: 1 },
  tickers: [{
    ticker: "AAPL", capturedAt: "2026-10-31T12:00:00Z", snapshotCount: 2, spot: 100, rv20: 0.18, ivRvspread: 0.145,
    buckets: [
      { bucket: "0DTE", dte: 0, atmIv: 0.225, expectedMove: null, expectedMovePct: null, termSlope: 0.1, skew25: 0.02, putCallVolumeRatio: 2, putCallOiRatio: 2, turnover: 0.1, atmSpreadPct: 0.2, zeroBidShare: 0.1, zeroAskShare: 0, volume: 300, openInterest: 3000, contracts: 2 },
      { bucket: "1-7D", dte: 7, atmIv: 0.325, expectedMove: 4.5, expectedMovePct: 0.045, termSlope: 0.075, skew25: 0.05, putCallVolumeRatio: 1, putCallOiRatio: 1, turnover: 0.2, atmSpreadPct: 0.4, zeroBidShare: 0.2, zeroAskShare: 0, volume: 100, openInterest: 1000, contracts: 2 },
    ],
    warnings: ["0DTE expected move is null: an intraday time-to-close model is not assumed."],
  }],
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock;

describe("Schwab Feature Lab", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<SchwabFeatureLab />); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

  it("renders ticker risk features, expected move and honest 0DTE nulls", () => {
    expect(host!.textContent).toContain("AAPL");
    expect(host!.textContent).toContain("18.0%");
    expect(host!.textContent).toContain("32.5%");
    expect(host!.textContent).toContain("4.50");
    expect(host!.textContent).toContain("Expected move");
    expect(host!.textContent).toContain("0DTE expected move is null");
    expect(host!.textContent).toContain("843ec5ec4eb7");
    expect(host!.textContent).toContain("Snapshots2");
  });
});
