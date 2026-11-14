import { describe, expect, it } from "vitest";
import { buildIntradayMarket, prepareIntradaySeries, type StoredIntradaySession } from "./intraday-views";

const stored: StoredIntradaySession = {
  session: "2026-11-13",
  updatedAt: "2026-11-13T14:45:00Z",
  previousClose: { AAPL: 100, MSFT: 200, SPY: 100, XLK: 50 },
  delayed: { AAPL: false, MSFT: null, SPY: false, XLK: false },
  bars: {
    AAPL: [{ end: "2026-11-13T14:40:00Z", o: 100, h: 102, l: 100, c: 101, v: 1000 }, { end: "2026-11-13T14:45:00Z", o: 101, h: 103, l: 101, c: 102, v: 500 }],
    MSFT: [{ end: "2026-11-13T14:40:00Z", o: 200, h: 200, l: 197, c: 198, v: 800 }, { end: "2026-11-13T14:45:00Z", o: 198, h: 198, l: 195, c: 196, v: 400 }],
    SPY: [{ end: "2026-11-13T14:40:00Z", o: 100, h: 101, l: 100, c: 100.5, v: 5000 }],
    XLK: [{ end: "2026-11-13T14:40:00Z", o: 50, h: 51, l: 50, c: 50.25, v: 2000 }],
  },
};

describe("intraday market computations", () => {
  it("computes cumulative VWAP from approximate bars without inventing missing volume", () => {
    const series = prepareIntradaySeries(stored, "AAPL");
    expect(series.bars[0].vwap).toBeCloseTo(101, 10);
    expect(series.vwap).toBeCloseTo((101 * 1000 + 102 * 500) / 1500, 10);
    expect(series.openGap).toBe(0);
    const noVolume = prepareIntradaySeries({ ...stored, bars: { ...stored.bars, AAPL: stored.bars.AAPL.map(bar => ({ ...bar, v: null })) } }, "AAPL");
    expect(noVolume.vwap).toBeNull();
    expect(noVolume.bars.every(bar => bar.vwap === null)).toBe(true);
  });

  it("builds per-step breadth, equal weight, SPY, all sector funds and movers with their paths", () => {
    const market = buildIntradayMarket(stored, [{ ticker: "AAPL", name: "Apple Inc." }, { ticker: "MSFT", name: "Microsoft" }], new Date("2026-11-13T14:50:00Z"));
    expect(market.marketOpen).toBe(true);
    expect(market.delayed).toBeNull();
    expect(market.coverage).toEqual({ expected: 2, measured: 2 });
    expect(market.breadth).toEqual([
      { time: "2026-11-13T14:40:00Z", above: 1, measured: 2, share: 0.5 },
      { time: "2026-11-13T14:45:00Z", above: 1, measured: 2, share: 0.5 },
    ]);
    expect(market.equalWeight.change).toBe(0);
    expect(market.spy.change).toBeCloseTo(0.005, 10);
    expect(market.sectors).toHaveLength(11);
    expect(market.sectors.find(row => row.ticker === "XLK")?.change).toBeCloseTo(0.005, 10);
    expect(market.movers.map(row => row.ticker)).toEqual(["AAPL", "MSFT"]);
    for (const [index, value] of [0.01, 0.02].entries()) expect(market.paths.AAPL[index].value).toBeCloseTo(value, 12);
    for (const [index, value] of [-0.01, -0.02].entries()) expect(market.paths.MSFT[index].value).toBeCloseTo(value, 12);
  });
});
