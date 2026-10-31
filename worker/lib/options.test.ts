import { describe, expect, it } from "vitest";
import {
  normalizeAlphaVantage,
  normalizeCboe,
  normalizeEodhd,
  oratsAvailableAt,
  oratsRecordToContracts,
  parseOsiSymbol,
  snapshotQuality,
} from "./options";

const now = "2026-10-26T00:00:00Z";

describe("options OSI and provider adapters", () => {
  it("parses OSI contract symbols with variable underlyings and strike decimals", () => {
    expect(parseOsiSymbol("AAPL261026C00245000")).toEqual({ underlying: "AAPL", expiration: "2026-10-26", strike: 245, right: "call" });
    expect(parseOsiSymbol("IBM171117P00075000")).toEqual({ underlying: "IBM", expiration: "2017-11-17", strike: 75, right: "put" });
    expect(parseOsiSymbol("BAD261326C00000000")).toBeNull();
  });

  it("normalizes Cboe chain and keeps underlying quote separate", () => {
    const snapshot = normalizeCboe({
      timestamp: "2026-10-26 01:00:00", symbol: "AAPL",
      data: {
        symbol: "AAPL", current_price: 100,
        options: [
          { option: "AAPL261120C00100000", bid: 4, ask: 5, bid_size: 2, ask_size: 3, iv: 0.3, delta: 0.5, volume: 10, open_interest: 20, theo: 4.5 },
          { option: "AAPL261120P00100000", bid: 3, ask: 4, iv: 0.4, delta: -0.5, volume: 11, open_interest: 21 },
        ],
      },
    }, now);
    expect(snapshot.underlying).toBe("AAPL");
    expect(snapshot.underlyingData).toMatchObject({ current_price: 100 });
    expect(snapshot.underlyingData).not.toHaveProperty("options");
    expect(snapshot.quality.rows).toBe(2);
    expect(snapshot.quality.contracts).toBe(2);
    expect(snapshot.quality.calls).toBe(1);
    expect(snapshot.quality.puts).toBe(1);
    expect(snapshot.quality.duplicates).toBe(0);
  });

  it("groups EODHD time series by tradeDate instead of mixing chains", () => {
    const row = (date: string, bidDate: string) => ({
      id: `AAPL261120C00100000-${bidDate}`,
      attributes: {
        contract: "AAPL261120C00100000", underlying_symbol: "AAPL", exp_date: "2026-11-20",
        type: "call", strike: 100, exchange: "NASDAQ", bid: 4, ask: 5, bid_date: bidDate,
        volatility: 0.3, delta: 0.5, tradetime: date,
      },
    });
    const snapshots = normalizeEodhd({ data: [row("2026-10-22", "2026-10-22T20:00:00Z"), row("2026-10-23", "2026-10-23T20:00:00Z"), row("2026-10-23", "2026-10-23T21:00:00Z")] }, now);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].tradeDate).toBe("2026-10-22");
    expect(snapshots[1].tradeDate).toBe("2026-10-23");
    expect(snapshots[1].quality.rows).toBe(2);
    expect(snapshots[1].quality.contracts).toBe(1);
    expect(snapshots[1].quality.duplicates).toBe(1);
    expect(snapshots[1].contracts[0].providerRowId).toContain("2026-10-23T20:00:00Z");
  });

  it("normalizes Alpha Vantage mark separately from theoretical price", () => {
    const snapshot = normalizeAlphaVantage({ data: [{ contractID: "IBM171117C00075000", symbol: "IBM", expiration: "2017-11-17", strike: "75", type: "call", last: 38.35, mark: 72.28, bid: 70.45, ask: 74.1, implied_volatility: 0.4, delta: 0.9, date: "2017-11-15" }] }, now);
    expect(snapshot.contracts[0].midpoint).toBe(72.28);
    expect(snapshot.contracts[0].theoretical).toBeNull();
  });

  it("maps ORATS call and put fields from one row", () => {
    const contracts = oratsRecordToContracts({ ticker: "A", cOpra: "A240119C00055000", pOpra: "A240119P00055000", tradeDate: "1/3/2024", expirDate: "1/19/2024", strike: 100, cBidPx: 4, cAskPx: 5, cVolu: 10, cOi: 20, pBidPx: 3, pAskPx: 4, pVolu: 11, pOi: 21, smoothSmvVol: 0.3, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.03 });
    expect(contracts).toHaveLength(2);
    expect(contracts[0]).toMatchObject({ contractId: "A240119C00055000", right: "call", bid: 4, ask: 5, volume: 10, openInterest: 20, expiration: "2024-01-19", delta: 0.5 });
    expect(contracts[1]).toMatchObject({ contractId: "A240119P00055000", right: "put", bid: 3, ask: 4, volume: 11, openInterest: 21, expiration: "2024-01-19", delta: -0.5 });
    expect(contracts[0].impliedVolatility).toBe(0.3);
    expect(contracts[0].tradeDate).toBe("2024-01-03");
  });

  it("supports ORATS intraday field names and quote timestamps", () => {
    const contracts = oratsRecordToContracts({ ticker: "AAPL", tradeDate: "2022-08-08", expirDate: "2022-08-12", strike: 70, callBidPrice: 97.25, callAskPrice: 97.45, callVolume: 1, callOpenInterest: 751, callSmvVol: 0.377, putBidPrice: 0, putAskPrice: 0, putVolume: 0, putOpenInterest: 0, putSmvVol: 0.55, delta: 0.999 });
    expect(contracts[0]).toMatchObject({ bid: 97.25, ask: 97.45, volume: 1, openInterest: 751, impliedVolatility: 0.377 });
    expect(contracts[1].impliedVolatility).toBe(0.55);
    expect(contracts[0].contractId).toBeTruthy();
    expect(contracts[0].contractId).not.toBe(contracts[1].contractId);
    expect(oratsAvailableAt({ updatedAt: "2022-08-08T14:03:51Z" }, "fallback")).toBe("2022-08-08T14:03:51Z");
  });

  it("counts duplicates, zero bids, crossed quotes and invalid rows honestly", () => {
    const contracts = [
      { contractId: "x", underlying: "A", expiration: "2026-01-01", strike: 100, right: "call", exchange: null, providerRowId: null, bid: 0, ask: 1, bidSize: null, askSize: null, last: null, volume: null, openInterest: null, impliedVolatility: null, delta: null, gamma: null, theta: null, vega: null, rho: null, theoretical: null, midpoint: null, tradeDate: null },
      { contractId: "x", underlying: "A", expiration: "2026-01-01", strike: 100, right: "call", exchange: null, providerRowId: null, bid: 5, ask: 4, bidSize: null, askSize: null, last: null, volume: null, openInterest: null, impliedVolatility: null, delta: null, gamma: null, theta: null, vega: null, rho: null, theoretical: null, midpoint: null, tradeDate: null },
    ] as const;
    const q = snapshotQuality([...contracts]);
    expect(q.rows).toBe(2);
    expect(q.contracts).toBe(1);
    expect(q.duplicates).toBe(1);
    expect(q.zeroBid).toBe(1);
    expect(q.crossedQuotes).toBe(1);
  });
});
