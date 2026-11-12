import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildDeskSnapshot,
  closeOnOrBefore,
  computeSectors,
  earningsDrift,
  earningsReaction,
  insiderSummary,
  momentum12m1,
  normalizeTicker,
  projectNextEarnings,
  resolveSession,
  schwabFundamentals,
  seriesMetrics,
  shortInterestSummary,
  spliceCloses,
  type Close,
} from "./desk-snapshot";
import type { DeskCompany } from "../../contracts/desk-snapshot";

/** Weekday closes from `start` to `end` inclusive, priced by a function of the running index. */
function weekdays(start: string, end: string, price: (index: number) => number): Close[] {
  const out: Close[] = [];
  for (let date = start, index = 0; date <= end; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push({ date, close: price(index) });
    index++;
  }
  return out;
}

describe("desk snapshot dates", () => {
  it("shifts months with the day clamped to the month end", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-11-10", -12)).toBe("2025-11-10");
    expect(addMonths("2026-11-10", 2)).toBe("2027-01-10");
  });
});

describe("spliceCloses", () => {
  it("keeps the Stooq history and adds Schwab bars only after the last Stooq date", () => {
    const series = spliceCloses([
      { date: "2026-11-05", close: 100, source: "stooq" },
      { date: "2026-11-06", close: 101, source: "stooq" },
      { date: "2026-11-06", close: 102.5, source: "schwab" },
      { date: "2026-11-09", close: 103, source: "schwab" },
      { date: "2026-11-04", close: 99, source: "stooq" },
      { date: "2026-11-10", close: null, source: "schwab" },
      { date: "2026-11-03", close: 0, source: "stooq" },
      { date: "2026-11-02", close: 98, source: "schwab-hist" },
    ]);
    expect(series).toEqual([
      { date: "2026-11-04", close: 99 },
      { date: "2026-11-05", close: 100 },
      { date: "2026-11-06", close: 101 },
      { date: "2026-11-09", close: 103 },
    ]);
    expect(closeOnOrBefore(series, "2026-11-08")).toEqual({ date: "2026-11-06", close: 101 });
    expect(closeOnOrBefore(series, "2026-11-01")).toBeNull();
  });
});

describe("seriesMetrics", () => {
  const steady = weekdays("2025-01-01", "2026-11-10", (index) => 100 * 1.001 ** index);

  it("measures returns to the session close with calendar look-backs", () => {
    const metrics = seriesMetrics(steady, "2026-11-10", "2026-11-09")!;
    const at = (date: string) => closeOnOrBefore(steady, date)!.close;
    const last = steady.at(-1)!.close;
    expect(metrics.lastDate).toBe("2026-11-10");
    expect(metrics.returns.d1).toBeCloseTo(0.001, 12);
    expect(metrics.returns.w1).toBeCloseTo(last / at("2026-11-03") - 1, 12);
    expect(metrics.returns.m1).toBeCloseTo(last / at("2026-10-10") - 1, 12);
    expect(metrics.returns.ytd).toBeCloseTo(last / at("2025-12-31") - 1, 12);
    expect(metrics.returns.y1).toBeCloseTo(last / at("2025-11-10") - 1, 12);
    // a steadily rising series: the session close is the 52-week high, and constant log returns have no spread
    expect(metrics.high52).toBe(last);
    expect(metrics.fullYear).toBe(true);
    expect(metrics.vol20).toBeCloseTo(0, 9);
    expect(metrics.ma50).toBeCloseTo(steady.slice(-50).reduce((sum, point) => sum + point.close, 0) / 50, 9);
    expect(metrics.spark).toHaveLength(63);
  });

  it("gives a series behind the session its close but no returns", () => {
    const behind = steady.filter((point) => point.date <= "2026-11-06");
    const metrics = seriesMetrics(behind, "2026-11-10", "2026-11-09")!;
    expect(metrics.lastDate).toBe("2026-11-06");
    expect(Object.values(metrics.returns).every((value) => value === null)).toBe(true);
  });

  it("drops a look-back whose base is far from its anchor and a one-session move across a missing session", () => {
    const young = weekdays("2026-10-20", "2026-11-10", (index) => 50 + index);
    const gap = young.filter((point) => point.date !== "2026-11-09");
    const metrics = seriesMetrics(gap, "2026-11-10", "2026-11-09")!;
    expect(metrics.returns.d1).toBeNull();
    expect(metrics.returns.w1).not.toBeNull();
    expect(metrics.returns.m3).toBeNull();
    expect(metrics.fullYear).toBe(false);
    expect(metrics.ma200).toBeNull();
  });

  it("annualizes the spread of the last 20 daily log returns", () => {
    const zigzag = weekdays("2026-09-01", "2026-11-10", (index) => (index % 2 ? 101 : 100));
    const metrics = seriesMetrics(zigzag, "2026-11-10", "2026-11-09")!;
    const up = Math.log(101 / 100);
    // 20 alternating returns of ±up: mean 0, sample variance 20·up²/19
    expect(metrics.vol20).toBeCloseTo(Math.sqrt((20 * up * up) / 19) * Math.sqrt(252), 12);
  });
});

describe("resolveSession", () => {
  it("takes the latest date at least half of the series reached and the calendar date before it", () => {
    const lastDates = ["2026-11-10", "2026-11-10", "2026-11-09", "2026-11-11", "2026-11-06"];
    expect(resolveSession(lastDates, ["2026-11-06", "2026-11-09", "2026-11-10"])).toEqual({ session: "2026-11-10", previousSession: "2026-11-09" });
    expect(resolveSession([], [])).toBeNull();
  });
});

describe("earnings", () => {
  const series = weekdays("2026-10-01", "2026-11-10", (index) => 100 + index);

  it("measures the reaction from the close before the report to the session after it", () => {
    const before = closeOnOrBefore(series, "2026-10-28")!.close;
    const after = closeOnOrBefore(series, "2026-10-30")!.close;
    expect(earningsReaction(series, "2026-10-29")).toEqual({ reaction: after / before - 1, sessions: 2 });
    const onDay = closeOnOrBefore(series, "2026-11-10")!.close;
    expect(earningsReaction(series, "2026-11-10")).toEqual({ reaction: onDay / closeOnOrBefore(series, "2026-11-09")!.close - 1, sessions: 1 });
    expect(earningsReaction(series, "2026-09-01")).toBeNull();
  });

  it("projects from the same quarter a year earlier, else 13 weeks on, and drops a projection already passed", () => {
    // reports on Thursdays: the Q4 report a year ago came 13 weeks + 1 day after Q3
    const history = ["2025-10-30", "2026-01-29", "2026-04-30", "2026-07-30", "2026-10-29"];
    expect(projectNextEarnings(history, "2026-10-29", "2026-11-10")).toEqual({ date: "2027-01-28", basis: "history" });
    expect(projectNextEarnings([], "2026-10-29", "2026-11-10")).toEqual({ date: "2027-01-28", basis: "cadence" });
    expect(projectNextEarnings([], "2026-08-05", "2026-11-10")).toBeNull();
    expect(projectNextEarnings([], null, "2026-11-10")).toBeNull();
  });
});

describe("after the report, momentum, short interest and insiders", () => {
  const series = weekdays("2025-06-02", "2026-11-10", (index) => 100 + index);

  it("measures the drift from the close that ends the reaction window", () => {
    const start = closeOnOrBefore(series, "2026-10-30")!.close;
    const last = series.at(-1)!.close;
    expect(earningsDrift(series, "2026-10-29")).toEqual({ drift: last / start - 1, sessions: 7 });
    // the report day is the last or the second-to-last stored session: no drift yet
    expect(earningsDrift(series, "2026-11-10")).toBeNull();
    expect(earningsDrift(series, "2026-11-09")).toBeNull();
  });

  it("reads momentum from a year ago to a month ago", () => {
    const value = momentum12m1(series, "2026-11-10")!;
    expect(value).toBeCloseTo(closeOnOrBefore(series, "2026-10-10")!.close / closeOnOrBefore(series, "2025-11-10")!.close - 1, 12);
    expect(momentum12m1(series.filter((point) => point.date >= "2026-01-01"), "2026-11-10")).toBeNull();
  });

  it("summarises short interest with the change from the reading before", () => {
    expect(
      shortInterestSummary([
        { date: "2026-10-15", shares: 110, pctFloat: 0.011, daysToCover: 2.2 },
        { date: "2026-09-30", shares: 100, pctFloat: 0.01, daysToCover: 2 },
        { date: "2026-10-15", shares: 110, pctFloat: 0.011, daysToCover: 2.2 },
      ]),
    ).toEqual({ date: "2026-10-15", shares: 110, pctFloat: 0.011, daysToCover: 2.2, changePct: 110 / 100 - 1 });
    expect(shortInterestSummary([])).toBeNull();
  });

  it("counts open-market purchases outside trading plans and all open-market sales", () => {
    const rows = [
      { date: "2026-11-02", code: "P", insider: "Tan Lip Bu", shares: 100, price: 60, plan: false },
      { date: "2026-10-20", code: "P", insider: "TAN LIP BU", shares: 50, price: 62, plan: false },
      { date: "2026-10-21", code: "P", insider: "Other Person", shares: 10, price: 61, plan: true },
      { date: "2026-10-22", code: "S", insider: "Seller", shares: 5, price: 61, plan: true },
      { date: "2026-10-23", code: "A", insider: "Grant", shares: 500, price: 0, plan: false },
      { date: "2026-07-01", code: "P", insider: "Too Old", shares: 900, price: 60, plan: false },
    ];
    expect(insiderSummary(rows, "2026-08-12")).toEqual({ buys: 2, buyers: 1, buyUsd: 100 * 60 + 50 * 62, lastBuy: "2026-11-02", sells: 1, sellUsd: 305 });
    expect(insiderSummary(rows, "2027-01-01")).toBeNull();
  });
});

describe("Schwab inputs", () => {
  it("reads market cap, ratios and the last earnings date; yield becomes a fraction", () => {
    const instrument = { instruments: [{ fundamental: { marketCap: 5.2e11, peRatio: 50.6, beta: 0.19, dividendYield: 2.4821, epsTTM: 5.81 } }] };
    const quote = { "BRK/B": { fundamental: { lastEarningsDate: "2026-11-02T00:00:00Z", divYield: 0 } } };
    expect(schwabFundamentals(instrument, quote)).toEqual({ marketCap: 5.2e11, pe: 50.6, beta: 0.19, dividendYield: 0.024821, epsTtm: 5.81, lastEarnings: "2026-11-02" });
    expect(schwabFundamentals({ instruments: [{ fundamental: { marketCap: 0, peRatio: -3 } }] }, null)).toMatchObject({ marketCap: null, pe: null, lastEarnings: null });
    expect(normalizeTicker("BRK/B")).toBe(normalizeTicker("BRK-B"));
  });
});

describe("aggregates and assembly", () => {
  const company = (ticker: string, sector: string, marketCap: number | null, d1: number | null): DeskCompany =>
    ({ ticker, sector, marketCap, returns: { d1, w1: null, m1: null, m3: null, ytd: null, y1: null } }) as DeskCompany;

  it("weights sector returns by market cap and leaves out members without one", () => {
    const sectors = computeSectors([company("A", "Tech", 300, 0.02), company("B", "Tech", 100, -0.02), company("C", "Tech", null, 0.5), company("D", "Energy", 50, 0.01)]);
    expect(sectors.map((sector) => sector.name)).toEqual(["Tech", "Energy"]);
    expect(sectors[0].returns.d1).toBeCloseTo(0.01, 12);
    expect(sectors[0]).toMatchObject({ companies: 3, marketCap: 400, advancers: 2, decliners: 1 });
  });

  it("builds a snapshot at the session most series reached", () => {
    const up = weekdays("2025-06-02", "2026-11-10", (index) => 10 + index * 0.01);
    const down = weekdays("2025-06-02", "2026-11-10", (index) => 500 - index * 0.1);
    const behind = up.filter((point) => point.date <= "2026-11-06");
    const snapshot = buildDeskSnapshot({
      generatedAt: "2026-11-11T00:00:00.000Z",
      codeVersion: "test",
      companies: [
        { cik: 1, ticker: "UP", registryTicker: "UP-PA", name: "Up Inc", sector: "Tech", industry: null, research: true },
        { cik: 2, ticker: "DN", registryTicker: "DN", name: "Down Co", sector: "Energy", industry: null, research: false },
        { cik: 3, ticker: "OLD", registryTicker: "OLD", name: "Behind Corp", sector: null, industry: null, research: true },
        { cik: 4, ticker: "NONE", registryTicker: "NONE", name: "No Prices", sector: "Tech", industry: null, research: false },
      ],
      closes: new Map([[1, up], [2, down], [3, behind]]),
      benchmark: { ticker: "SPY", closes: up },
      fundamentals: new Map([["UP", { marketCap: 2e9, pe: 20, beta: 1, dividendYield: 0, epsTtm: 1, lastEarnings: "2026-10-29" }], ["DN", { marketCap: 1e9, pe: null, beta: null, dividendYield: null, epsTtm: null, lastEarnings: null }]]),
      options: new Map(),
      events: new Map([[1, ["2025-10-30", "2026-01-29", "2026-04-30", "2026-07-30"]]]),
      inputs: { priceRows: 0, schwabQuoteDates: [], fundamentals: 2, quotes: 2, optionTickers: 0, optionsGeneratedAt: null, earningsEvents: 4 },
    });
    expect(snapshot.session).toBe("2026-11-10");
    expect(snapshot.previousSession).toBe("2026-11-09");
    expect(snapshot.companies.map((row) => row.ticker)).toEqual(["UP", "DN", "OLD"]);
    expect(snapshot.inputs.companiesWithoutPrices).toEqual(["NONE"]);
    const up1 = snapshot.companies[0];
    expect(up1.registryTicker).toBe("UP-PA");
    expect(up1.lastEarnings).toBe("2026-10-29");
    expect(up1.nextEarnings).toBe("2027-01-28");
    expect(up1.nextEarningsBasis).toBe("history");
    expect(snapshot.companies[2]).toMatchObject({ sector: "Other", lastDate: "2026-11-06" });
    expect(snapshot.companies[2].returns.d1).toBeNull();
    expect(snapshot.breadth).toMatchObject({ measured: 2, advancers: 1, decliners: 1, newHighs: 1, newLows: 1 });
    expect(snapshot.benchmark?.returns.d1).toBeGreaterThan(0);
  });
});
