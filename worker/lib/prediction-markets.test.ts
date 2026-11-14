import { describe, expect, it } from "vitest";
import { buildPredictionExpectations, candleProbability, dailyExpectationState, distribution, excludedMarket, kalshiSnapshot, liquidityFlag, numericMarket, polyOutcome, polymarketSnapshot, quoteDay, settled, thresholdOf, type JsonObject } from "./prediction-markets";
import { FIXTURE_NOTICE, KALSHI_CANDLE_RESPONSE, KALSHI_COMPANY_SETTLED, KALSHI_CPI_RESPONSE, KALSHI_FED_RESPONSE, KALSHI_RECESSION_MARKET, POLY_CPI_EVENT, POLY_FED_EVENT, POLY_RECESSION_EVENT, POLY_SETTLED_EVENT, POLY_SETTLED_MARKET } from "../../src/test-fixtures/prediction-markets/responses";

const NOW = "2026-11-14T00:00:00.000Z";
const objects = (values: unknown[]): JsonObject[] => values as JsonObject[];

function snapshots() {
  return [
    ...objects(KALSHI_FED_RESPONSE.markets).map(market => kalshiSnapshot(market, NOW)),
    ...objects(KALSHI_CPI_RESPONSE.markets).map(market => kalshiSnapshot(market, NOW)),
    kalshiSnapshot(KALSHI_RECESSION_MARKET, NOW),
    ...POLY_FED_EVENT.markets.map(market => polymarketSnapshot(market, POLY_FED_EVENT, "fed", NOW)),
    ...POLY_CPI_EVENT.markets.map(market => polymarketSnapshot(market, POLY_CPI_EVENT, "cpi", NOW)),
    ...POLY_RECESSION_EVENT.markets.map(market => polymarketSnapshot(market, POLY_RECESSION_EVENT, "recession", NOW)),
  ];
}

describe("prediction-market response parsers", () => {
  it("parses driver-shaped Kalshi strings, strikes, rules and liquidity", () => {
    const row = kalshiSnapshot(KALSHI_FED_RESPONSE.markets[2], NOW);
    expect(FIXTURE_NOTICE).toContain("never live data");
    expect(row).toMatchObject({ venue: "kalshi", market: "KXFED-26DEC-T4.00", yesBid: 0.21, yesAsk: 0.23, last: 0.22, volume: 50000, openInterest: 10000, floor: 4, liquidityFlag: "ok", result: null });
    expect(row.rulesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(thresholdOf(row)).toBe(4);
    expect(numericMarket(KALSHI_FED_RESPONSE.markets[2])).toBe(true);
  });

  it("parses Polymarket token arrays, outcome probabilities and settlement", () => {
    const row = polymarketSnapshot(POLY_SETTLED_MARKET, POLY_SETTLED_EVENT, "fed", NOW);
    expect(row).toMatchObject({ venue: "polymarket", market: "poly-settled-nochange", status: "closed", result: "yes", settlementValue: 1, liquidityFlag: "ok" });
    expect(polyOutcome("No change in Fed interest rates after December 2026 meeting?")).toEqual({ change: 0, orMore: false });
    expect(polyOutcome("Fed decreases interest rates by 25 bps after December 2026 meeting?")).toEqual({ change: -25, orMore: false });
    expect(polyOutcome("Fed increases interest rates by 25+ bps after December 2026 meeting?")).toEqual({ change: 25, orMore: true });
    expect(polymarketSnapshot({ ...POLY_SETTLED_MARKET, outcomePrices: "[\"\",\"\"]" }, POLY_SETTLED_EVENT, "fed", NOW).result).toBeNull();
  });

  it("keeps political, sports and earnings-call wording markets out, not Fed or CPI", () => {
    expect(excludedMarket("Who wins the presidential election?")).toBe(true);
    expect(excludedMarket("Who wins the NBA championship?")).toBe(true);
    expect(excludedMarket("What will the CEO say on the earnings call?")).toBe(true);
    expect(excludedMarket("Will the Fed cut rates?")).toBe(false);
    expect(excludedMarket("Will CPI rise above 0.2%?")).toBe(false);
  });

  it("applies the liquidity gate without inventing missing fields", () => {
    expect(liquidityFlag(0.5, 0.55, 10000, 5000)).toBe("ok");
    expect(liquidityFlag(0.5, 0.56, 10000, 5000)).toBe("thin");
    expect(liquidityFlag(0.5, 0.55, 9999, 5000)).toBe("thin");
    expect(liquidityFlag(0.5, 0.55, null, 5000)).toBe("unknown");
    expect(liquidityFlag(0.5, 0.55, 10000, null)).toBe("unknown");
    expect(liquidityFlag(null, null, 10000, 5000)).toBe("unknown");
  });

  it("captures settlement and the actual numeric result", () => {
    expect(settled(KALSHI_COMPANY_SETTLED)).toBe(true);
    expect(kalshiSnapshot(KALSHI_COMPANY_SETTLED, NOW, { series: "KXBBY", ticker: "BBY", cik: 764478, kind: "business" })).toMatchObject({ result: "yes", settlementValue: 4.5, settlementRaw: "4.5", cik: 764478, kind: "business" });
  });

  it("uses a narrow quote midpoint, falls back to the last trade, and dates the quote day", () => {
    expect(candleProbability(KALSHI_CANDLE_RESPONSE.candlesticks[0])).toEqual({ value: 0.55, how: "mid" });
    expect(candleProbability(KALSHI_CANDLE_RESPONSE.candlesticks[1])).toEqual({ value: 0.42, how: "trade" });
    expect(quoteDay(KALSHI_CANDLE_RESPONSE.candlesticks[1].end_period_ts)).toBe("2026-11-13");
  });
});

describe("prediction-market expectations", () => {
  it("keeps survival probabilities non-increasing and requires a covered distribution", () => {
    expect(distribution([[0, 0.8], [1, 0.4], [2, 0.5], [3, 0.1]]).mean).not.toBeNull();
    expect(distribution([[0, 0.4], [1, 0.1]]).covered).toBe(false);
    expect(distribution([])).toEqual({ mean: null, sd: null, covered: false });
  });

  it("builds Fed outcomes and CPI and recession expectations from both response shapes", () => {
    const report = buildPredictionExpectations(snapshots(), NOW, 4);
    expect(report.status).toBe("ok");
    expect(report.closed).toBe(false);
    expect(report.fed.meeting).toBe("2026-12-09T19:00:00Z");
    expect(report.fed.expectedUpper.primary).not.toBeNull();
    expect(report.fed.outcomes.cut.primary).toBeCloseTo(0.15);
    expect(report.fed.outcomes.hike.primary).toBeCloseTo(0.22);
    expect(report.fed.outcomes.unchanged.primary).toBeCloseTo(0.63);
    expect(report.fed.outcomes.cut.alternate).toBeCloseTo(0.3);
    expect(report.fed.outcomes.unchanged.alternate).toBeCloseTo(0.55);
    expect(report.fed.outcomes.hike.alternate).toBeCloseTo(0.15);
    expect(report.cpi.expected.primary).not.toBeNull();
    expect(report.cpi.expected.alternate).not.toBeNull();
    expect(report.cpi.spread.primary).not.toBeNull();
    expect(report.recession.probability).toEqual({ primary: 0.22, alternate: 0.19 });
    expect(report.calibration.fed).toContain("0.99 skill the day before");
    expect(JSON.stringify(report)).not.toMatch(/kalshi|polymarket/i);
  });

  it("extends the daily expectation state without replacing missing values with zero", () => {
    const report = buildPredictionExpectations(snapshots(), NOW, 4);
    const state = dailyExpectationState(report, "2026-11-13");
    expect(state.date).toBe("2026-11-13");
    expect(state.fedNow).toBe(4);
    expect(state.fed1Expected).not.toBeNull();
    expect(state.fed1PCut).toBeCloseTo(0.15);
    expect(state.fed1PHike).toBeCloseTo(0.22);
    expect(state.cpiNextExpected).not.toBeNull();
    expect(state.recessionThisYear).toBe(0.22);
    const empty = dailyExpectationState(buildPredictionExpectations([], NOW), "2026-11-14");
    expect(empty).toEqual({ date: "2026-11-14" });
  });

  it("marks a closed report and preserves its last quote time", () => {
    const report = buildPredictionExpectations([kalshiSnapshot(KALSHI_COMPANY_SETTLED, NOW)], NOW);
    expect(report.closed).toBe(true);
    expect(report.asOf).toBe(NOW);
    expect(report.status).toBe("partial");
  });

  it("uses only current US recession and CPI events on the alternate feed", () => {
    const canada = { ...POLY_RECESSION_EVENT, slug: "canada-recession-before-2027", title: "Canada recession before 2027", markets: POLY_RECESSION_EVENT.markets.map(market => ({ ...market, question: "Canada recession before 2027?", bestBid: 0.998, bestAsk: 0.999, lastTradePrice: 0.999 })) };
    const uk = { ...POLY_CPI_EVENT, slug: "october-inflation-uk-annual-2026", title: "UK annual inflation", markets: POLY_CPI_EVENT.markets.map(market => ({ ...market, question: "Will UK annual inflation be at least 3.1% in October?" })) };
    const rows = [...snapshots(), ...canada.markets.map(market => polymarketSnapshot(market, canada, "recession", NOW)), ...uk.markets.map(market => polymarketSnapshot(market, uk, "cpi", NOW))];
    const report = buildPredictionExpectations(rows, NOW, 4);
    expect(report.recession.probability.alternate).toBe(0.19);
    expect(report.cpi.expected.alternate).not.toBeNull();
    const ukOnly = buildPredictionExpectations(uk.markets.map(market => polymarketSnapshot(market, uk, "cpi", NOW)), NOW, 4);
    expect(ukOnly.cpi.expected.alternate).toBeNull();
  });
});
