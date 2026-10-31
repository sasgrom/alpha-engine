import { describe, expect, it } from "vitest";
import { dteDays, normalizeSchwabChain, osiOptionId, osiStrike, schwabQa } from "./schwab-normalize";

const chain = JSON.stringify({
  symbol: "AAPL",
  status: "SUCCESS",
  isDelayed: false,
  underlyingPrice: 344.9,
  isChainTruncated: false,
  callExpDateMap: {
    "2026-10-30:0": {
      "345.0": [
        { symbol: "AAPL 261030C00345000", strikePrice: 345, bid: 2.1, ask: 2.2, last: 2.15, mark: null, totalVolume: 100, openInterest: 500, volatility: 29, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.02 },
      ],
      "350.0": [
        { symbol: "AAPL 261030C00350000", strikePrice: 350, bid: 0, ask: 2.5, last: 2.4, totalVolume: 0, openInterest: 0, volatility: 30, delta: 0.45, gamma: 0.02, theta: -0.01, vega: 0.08, rho: 0.01 },
      ],
    },
  },
  putExpDateMap: {},
});

describe("Schwab chain normalization", () => {
  it("formats OSI identifiers and DTE without truncating contracts", () => {
    expect(osiStrike(345)).toBe("00345000");
    expect(osiOptionId("AAPL", "2026-10-30", "CALL", 345)).toBe("AAPL  261030C00345000");
    expect(dteDays("2026-10-30", "2026-10-30T12:00:00Z")).toBe(0);
    const normalized = normalizeSchwabChain(chain, "2026-10-30T12:00:00Z");
    expect(normalized.rows).toHaveLength(2);
    expect(normalized.rows[0].putCall).toBe("CALL");
    expect(normalized.rows[0].iv).toBe(0.29);
    expect(normalized.rows[0].spread).toBeCloseTo(0.1, 10);
    expect(normalized.rows[0].mark).toBeNull();
    expect(normalized.sourceStatus).toBe("SUCCESS");
    expect(normalized.chainTruncated).toBe(false);
  });

  it("detects duplicate IDs, zero quotes, crossed markets and invalid IV", () => {
    const normalized = normalizeSchwabChain(chain, "2026-10-30T12:00:00Z");
    const rows = [
      ...normalized.rows,
      normalized.rows[0],
      { ...normalized.rows[0], osiId: "AAPL  261030C00351000", ask: 1, iv: 900, delta: -999 },
    ];
    const qa = schwabQa(rows);
    expect(qa.duplicateOsi).toBe(1);
    expect(qa.zeroBid).toBe(1);
    expect(qa.zeroAsk).toBe(0);
    expect(qa.crossed).toBe(1);
    expect(qa.invalidGreeks).toBe(1);
    expect(qa.invalidIv).toBe(1);
  });
});
