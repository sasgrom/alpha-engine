import { describe, expect, it } from "vitest";
import { carAt, marketModelEventStudy, summarizeEventStudies, type EventBar } from "./event-study";

function bars(): { stock: EventBar[]; market: EventBar[] } {
  const stock: EventBar[] = [{ date: "2020-01-01", close: 100 }], market: EventBar[] = [{ date: "2020-01-01", close: 1000 }];
  for (let i = 1; i < 400; i++) {
    const date = `2020-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + i % 28).padStart(2, "0")}`;
    const marketRet = 0.002 * ((i % 5) - 2);
    const stockRet = 0.0005 + 1.2 * marketRet + (i === 300 ? 0.05 : 0);
    market.push({ date, close: market.at(-1)!.close * (1 + marketRet) });
    stock.push({ date, close: stock.at(-1)!.close * (1 + stockRet) });
  }
  return { stock, market };
}

describe("market-model event study", () => {
  it("estimates pre-event beta and isolates the event-day abnormal return", () => {
    const { stock, market } = bars();
    const result = marketModelEventStudy(stock, market, stock[300].date, { session: "pre_open", horizon: 3 })!;
    expect(result.startDate).toBe(stock[300].date);
    expect(result.estimationN).toBe(120);
    expect(result.beta).toBeCloseTo(1.2);
    expect(result.points[0].abnormalReturn).toBeCloseTo(0.05, 6);
    expect(carAt(result, 2)).toBeCloseTo(0.05, 6);
    const summary = summarizeEventStudies([result], 2);
    expect(summary.n).toBe(1);
    expect(summary.meanCar).toBeCloseTo(0.05, 6);
  });

  it("starts on the next session for post-close disclosure and rejects thin history", () => {
    const { stock, market } = bars();
    const result = marketModelEventStudy(stock, market, stock[300].date, { session: "post_close", horizon: 1 })!;
    expect(result.startDate).toBe(stock[301].date);
    expect(marketModelEventStudy(stock.slice(0, 10), market, stock[5].date)).toBeNull();
  });
});
