import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSchwabMarketSnapshot } from "./schwab-market-data";
import { sha256Text } from "./schwab-normalize";

const chain = JSON.stringify({ symbol: "AAPL", status: "SUCCESS", isDelayed: false, isChainTruncated: false, underlyingPrice: 344.9, callExpDateMap: { "2026-10-30:0": { "345.0": [{ symbol: "AAPL 261030C00345000", strikePrice: 345, bid: 2.1, ask: 2.2, last: 2.15, totalVolume: 100, openInterest: 500, volatility: 29, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.02 }] } }, putExpDateMap: {} });
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("Schwab market snapshot builder", () => {
  it("builds normalized options and provenance without exposing token values", () => {
    const root = mkdtempSync(path.join(tmpdir(), "schwab-market-data-"));
    dirs.push(root);
    writeFileSync(path.join(root, "AAPL.json"), chain);
    const snapshot = buildSchwabMarketSnapshot({
      root,
      tickersExpected: 51,
      manifest: { schemaVersion: 1, tickers: [{ ticker: "AAPL", status: "complete", capturedAt: "2026-10-30T12:00:00Z", sourceHash: sha256Text(chain), file: "AAPL.json" }] },
      generatedAt: "2026-10-30T12:01:00Z",
      tokenExpiresAt: "2026-10-30T23:00:00Z",
      lastRefreshAt: "2026-10-30T12:00:00Z",
    });
    expect(snapshot.coverage.contracts).toBe(1);
    expect(snapshot.coverage.tickersCompleted).toBe(1);
    expect(snapshot.coverage.endpointsComplete).toBe(4);
    expect(snapshot.files[0].sourceHash).toBe(sha256Text(chain));
    expect(snapshot.options[0].osiId).toBe("AAPL  261030C00345000");
    expect(snapshot.qa.manifestErrors).toBe(0);
    expect(JSON.stringify(snapshot)).not.toContain("refresh_token");
    expect(JSON.stringify(snapshot)).not.toContain("access_token");
  });

  it("rejects a source hash mismatch instead of publishing stale provenance", () => {
    const root = mkdtempSync(path.join(tmpdir(), "schwab-market-data-"));
    dirs.push(root);
    writeFileSync(path.join(root, "AAPL.json"), chain);
    const snapshot = buildSchwabMarketSnapshot({
      root,
      tickersExpected: 51,
      manifest: { schemaVersion: 1, tickers: [{ ticker: "AAPL", status: "complete", capturedAt: "2026-10-30T12:00:00Z", sourceHash: "wrong", file: "AAPL.json" }] },
      generatedAt: "2026-10-30T12:01:00Z",
      tokenExpiresAt: null,
      lastRefreshAt: null,
    });
    expect(snapshot.options).toHaveLength(0);
    expect(snapshot.coverage.tickersCompleted).toBe(0);
    expect(snapshot.files[0].error).toBe("Source hash mismatch");
  });

  it("uses only the latest manifest entry per ticker and never hides a new failure behind old data", () => {
    const root = mkdtempSync(path.join(tmpdir(), "schwab-market-data-"));
    dirs.push(root);
    writeFileSync(path.join(root, "AAPL.json"), chain);
    const snapshot = buildSchwabMarketSnapshot({
      root,
      tickersExpected: 51,
      manifest: { schemaVersion: 1, tickers: [
        { ticker: "AAPL", status: "complete", capturedAt: "2026-10-29T12:00:00Z", sourceHash: sha256Text(chain), file: "AAPL.json" },
        { ticker: "AAPL", status: "failed", capturedAt: "2026-10-30T12:00:00Z", sourceHash: "", file: "AAPL.json", error: "HTTP 500" },
      ] },
      generatedAt: "2026-10-30T12:01:00Z",
      tokenExpiresAt: null,
      lastRefreshAt: null,
    });
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0].status).toBe("failed");
    expect(snapshot.options).toHaveLength(0);
    expect(snapshot.coverage.tickersCompleted).toBe(0);
  });
});
