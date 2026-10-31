import { describe, expect, it } from "vitest";
import { buildSchwabFeatureReport, rv20FromCandles } from "./schwab-features";
import type { SchwabMarketSnapshot, SchwabOptionRow } from "./schwab-normalize";

const row = (putCall: "CALL" | "PUT", dte: number, iv: number, delta: number, volume: number, openInterest: number): SchwabOptionRow => ({
  symbol: `AAPL-${putCall}-${dte}`, osiId: `AAPL-${putCall}-${dte}`, underlying: "AAPL", expiration: `2026-${dte === 0 ? "10-31" : dte === 7 ? "11-07" : "11-30"}`, dte,
  strike: 100, putCall, bid: putCall === "CALL" ? 9 : 9, ask: 11, last: 10, mark: 10, spread: 2, volume, openInterest,
  iv, delta, gamma: 0.01, theta: -0.01, vega: 0.1, rho: 0.01, underlyingPrice: 100, delayed: false, sourceHash: "x", sourceStatus: "SUCCESS",
});
const options = [row("CALL", 0, 0.2, 0.5, 100, 1000), row("PUT", 0, 0.25, -0.5, 200, 2000), row("CALL", 7, 0.3, 0.25, 50, 500), row("PUT", 7, 0.35, -0.25, 50, 500), row("CALL", 30, 0.4, 0.3, 25, 250)];
const snapshot: SchwabMarketSnapshot = {
  schemaVersion: 1, generatedAt: "2026-10-31T12:00:00Z", provider: "schwab",
  files: [{ ticker: "AAPL", file: "AAPL.json", sourceHash: "x", status: "complete", capturedAt: "2026-10-31T12:00:00Z" }],
  coverage: { tickersExpected: 1, tickersCompleted: 1, endpointsComplete: 4, errors: 0, contracts: options.length, expirations: 3, latestCapture: "2026-10-31T12:00:00Z", tokenExpiresAt: null, lastRefreshAt: null },
  options,
  qa: { duplicateOsi: 0, zeroBid: 0, zeroAsk: 0, crossed: 0, invalidGreeks: 0, invalidIv: 0, manifestErrors: 0 },
};
const candles = Array.from({ length: 22 }, (_, index) => ({ datetime: Date.parse(`2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`), close: 100 + index }));

describe("Schwab Feature Lab materialization", () => {
  it("computes ATM IV, expected move, slope, skew, ratios and spread without inventing 0DTE precision", () => {
    const report = buildSchwabFeatureReport({ snapshot, manifest: { tickers: [{ ticker: "AAPL" }, { ticker: "AAPL" }] }, prices: { AAPL: candles }, generatedAt: "2026-10-31T12:01:00Z" });
    const ticker = report.tickers[0];
    expect(ticker.snapshotCount).toBe(2);
    expect(ticker.rv20).not.toBeNull();
    expect(ticker.ivRvspread).not.toBeNull();
    const zero = ticker.buckets[0];
    expect(zero.atmIv).toBeCloseTo(0.225, 10);
    expect(zero.expectedMove).toBeNull();
    expect(zero.expectedMovePct).toBeNull();
    expect(zero.atmSpreadPct).toBeCloseTo(0.2, 10);
    expect(zero.putCallVolumeRatio).toBe(2);
    expect(zero.putCallOiRatio).toBe(2);
    expect(zero.turnover).toBeCloseTo(0.1, 10);
    expect(zero.termSlope).toBeCloseTo(0.1, 10);
    const week = ticker.buckets[1];
    expect(week.atmIv).toBeCloseTo(0.325, 10);
    expect(week.expectedMove).toBeCloseTo(100 * 0.325 * Math.sqrt(7 / 365), 10);
    expect(week.expectedMovePct).toBeCloseTo(0.325 * Math.sqrt(7 / 365), 10);
    expect(week.skew25).toBeCloseTo(0.05, 10);
    expect(week.termSlope).toBeCloseTo(0.075, 10);
    expect(ticker.warnings.some((warning) => warning.includes("0DTE"))).toBe(true);
    expect(report.sourceSnapshotSha256).toHaveLength(64);
  });

  it("uses only completed daily bars and requires 21 closes for RV20", () => {
    expect(rv20FromCandles(candles, "2026-10-22T12:00:00Z")).not.toBeNull();
    expect(rv20FromCandles(candles.slice(0, 20), "2026-10-22T12:00:00Z")).toBeNull();
    expect(rv20FromCandles(candles, "2026-10-01T12:00:00Z")).toBeNull();
  });
});
