import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256Text } from "../../worker/lib/schwab-normalize";
import { readDeskOptionChain } from "./desk-option-chain";

const contract = (strike: number, over: Record<string, unknown> = {}) => ({ symbol: `X ${strike}`, strikePrice: strike, bid: 2.1, ask: 2.2, last: 2.15, totalVolume: 100, openInterest: 500, volatility: 29, delta: 0.5, ...over });
const raw = (over: Record<string, unknown> = {}) => JSON.stringify({
  symbol: "AAPL", status: "SUCCESS", isDelayed: false, isChainTruncated: false, underlyingPrice: 344.9,
  callExpDateMap: {
    "2026-11-25:2": { "345.0": [contract(345)] },
    "2026-12-18:25": { "340.0": [contract(340, { delta: 0.62 })], "345.0": [contract(345, { volatility: 1208.9 })] },
  },
  putExpDateMap: { "2026-12-18:25": { "345.0": [contract(345, { delta: -0.48, bid: 5.5, ask: 5.7 })], "350.0": [contract(350, { delta: -0.6 })] } },
  ...over,
});

const roots: string[] = [];
function archive(entries: Array<{ ticker: string; capturedAt: string; text: string; status?: string; sourceHash?: string }>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "desk-option-chain-"));
  roots.push(root);
  mkdirSync(path.join(root, "chains"));
  const tickers = entries.map((entry, index) => {
    const file = `chains/${entry.ticker}-${index}.json`;
    writeFileSync(path.join(root, file), entry.text);
    return { ticker: entry.ticker, status: entry.status ?? "complete", capturedAt: entry.capturedAt, sourceHash: entry.sourceHash ?? sha256Text(entry.text), file };
  });
  writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ schemaVersion: 1, tickers }));
  return root;
}
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

describe("the desk's option chain", () => {
  it("reads the newest complete capture, lists its expirations and pairs calls with puts by strike", () => {
    const root = archive([
      { ticker: "AAPL", capturedAt: "2026-11-20T21:45:00.000Z", text: raw({ underlyingPrice: 300 }) },
      { ticker: "AAPL", capturedAt: "2026-11-23T21:45:00.000Z", text: raw() },
      // a later capture that failed is not the latest chain
      { ticker: "AAPL", capturedAt: "2026-11-24T21:45:00.000Z", text: raw({ underlyingPrice: 1 }), status: "partial" },
    ]);
    const chain = readDeskOptionChain({ ticker: "AAPL" }, root)!;
    expect(chain).toMatchObject({ ticker: "AAPL", capturedAt: "2026-11-23T21:45:00.000Z", underlyingPrice: 344.9, delayed: false });
    expect(chain.expirations).toEqual([{ date: "2026-11-25", dte: 2, contracts: 1 }, { date: "2026-12-18", dte: 25, contracts: 4 }]);
    // the first expiration at least a week out
    expect(chain.expiration).toBe("2026-12-18");
    expect(chain.strikes.map((row) => [row.strike, row.call?.delta ?? null, row.put?.delta ?? null])).toEqual([[340, 0.62, null], [345, 0.5, -0.48], [350, null, -0.6]]);
    expect(chain.strikes[1].put).toEqual({ bid: 5.5, ask: 5.7, last: 2.15, volume: 100, openInterest: 500, iv: 0.29, delta: -0.48 });
    // 1,209% is no volatility
    expect(chain.strikes[1].call?.iv).toBeNull();
    expect(readDeskOptionChain({ ticker: "AAPL", expiration: "2026-11-25" }, root)!.strikes.map((row) => row.strike)).toEqual([345]);
    // an expiration the capture does not have falls back to the default
    expect(readDeskOptionChain({ ticker: "AAPL", expiration: "2027-01-15" }, root)!.expiration).toBe("2026-12-18");
    expect(readDeskOptionChain({ ticker: "MSFT" }, root)).toBeNull();
  });

  it("refuses a chain that does not match the collector's hash, a file outside the archive, and a missing archive", () => {
    const changed = archive([{ ticker: "AAPL", capturedAt: "2026-11-23T21:45:00.000Z", text: raw(), sourceHash: "0".repeat(64) }]);
    expect(() => readDeskOptionChain({ ticker: "AAPL" }, changed)).toThrow("does not match the hash");
    const outside = archive([{ ticker: "AAPL", capturedAt: "2026-11-23T21:45:00.000Z", text: raw() }]);
    writeFileSync(path.join(outside, "manifest.json"), JSON.stringify({ schemaVersion: 1, tickers: [{ ticker: "AAPL", status: "complete", capturedAt: "2026-11-23T21:45:00.000Z", sourceHash: "x", file: "../token.json" }] }));
    expect(() => readDeskOptionChain({ ticker: "AAPL" }, outside)).toThrow("outside the option archive");
    expect(() => readDeskOptionChain({ ticker: "AAPL" }, path.join(os.tmpdir(), "no-such-option-archive"))).toThrow("Is the data drive connected?");
  });
});
