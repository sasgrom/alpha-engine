import { describe, expect, it } from "vitest";
import { isSchwabBodyOverflow, mergeSchwabChunks, monthlySchwabChunks } from "./schwab-chain-chunks";
import { normalizeSchwabChain, sha256Text } from "./schwab-normalize";

const chain = (date: string, strike: number) => JSON.stringify({
  symbol: "MU", status: "SUCCESS", isDelayed: false, isChainTruncated: false, underlyingPrice: 200,
  callExpDateMap: { [`${date}:30`]: { [String(strike)]: [{ symbol: `MU ${date.slice(2).replaceAll("-", "")}C00${strike}000`, strikePrice: strike, bid: 1, ask: 1.1, volatility: 40 }] } },
  putExpDateMap: {},
});

describe("Schwab oversized chain chunks", () => {
  it("creates bounded non-overlapping monthly windows", () => {
    const chunks = monthlySchwabChunks("2026-10-31", 3);
    expect(chunks).toEqual([
      { fromDate: "2026-10-31", toDate: "2026-10-31" },
      { fromDate: "2026-11-01", toDate: "2026-11-30" },
      { fromDate: "2026-12-01", toDate: "2026-12-31" },
    ]);
    expect(monthlySchwabChunks("2026-10-31")).toHaveLength(60);
  });

  it("recognizes only the explicit provider body-overflow response", () => {
    const error = Object.assign(new Error("HTTP 502: Body buffer overflow / TooBigBody"), { httpStatus: 502 });
    expect(isSchwabBodyOverflow(error)).toBe(true);
    expect(isSchwabBodyOverflow(Object.assign(new Error("HTTP 502 other"), { httpStatus: 502 }))).toBe(false);
    expect(isSchwabBodyOverflow(Object.assign(new Error("HTTP 401"), { httpStatus: 401 }))).toBe(false);
  });

  it("merges every contract and preserves immutable chunk hashes", () => {
    const first = chain("2026-11-30", 200);
    const second = chain("2026-12-31", 210);
    const merged = mergeSchwabChunks([
      { fromDate: "2026-11-01", toDate: "2026-11-30", raw: first },
      { fromDate: "2026-12-01", toDate: "2026-12-31", raw: second },
    ]);
    const normalized = normalizeSchwabChain(merged, "2026-10-31T12:00:00Z");
    expect(normalized.rows).toHaveLength(2);
    expect(normalized.rows.map((row) => row.strike)).toEqual([200, 210]);
    const doc = JSON.parse(merged) as { _alphaChunking: { chunks: { sha256: string }[] }; isChainTruncated: boolean };
    expect(doc._alphaChunking.chunks.map((chunk) => chunk.sha256)).toEqual([sha256Text(first), sha256Text(second)]);
    expect(doc.isChainTruncated).toBe(false);
  });
});
