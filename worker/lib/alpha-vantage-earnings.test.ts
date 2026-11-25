import { describe, expect, it } from "vitest";
import { classifyAnswer, pickTickers, symbolsFor, type Manifest } from "./alpha-vantage-earnings";

const quarter = (end: string, overrides: Record<string, unknown> = {}) => ({ fiscalDateEnding: end, reportedDate: "2026-10-21", reportedEPS: "2.95", estimatedEPS: "2.88", surprise: "0.07", surprisePercentage: "2.4306", reportTime: "post-market", ...overrides });
const manifest = (tickers: Manifest["tickers"] = {}): Manifest => ({ schemaVersion: 1, source: "test", tickers, runs: [] });
const stored = (cik: number, ticker: string, date: string) => ({ cik, ticker, symbol: ticker, files: [{ date, file: `raw/${ticker}/${date}.json`, sha256: "x", bytes: 1, quarters: 1, withEstimate: 1, first: "2026-09-30", last: "2026-09-30" }] });

describe("Alpha Vantage earnings answers", () => {
  it("reads a company's quarters with numbers and missing estimates", () => {
    const answer = classifyAnswer({ symbol: "IBM", annualEarnings: [{}], quarterlyEarnings: [quarter("2026-09-30"), quarter("1996-03-31", { estimatedEPS: "None", surprise: "None", surprisePercentage: "None", reportTime: "" })] });
    expect(answer).toMatchObject({ kind: "data", symbol: "IBM", annual: 1 });
    if (answer.kind !== "data") throw new Error("expected data");
    expect(answer.quarters[0]).toEqual({ fiscalDateEnding: "2026-09-30", reportedDate: "2026-10-21", reportedEPS: 2.95, estimatedEPS: 2.88, surprise: 0.07, surprisePercentage: 2.4306, reportTime: "post-market" });
    expect(answer.quarters[1]).toMatchObject({ estimatedEPS: null, surprise: null, reportTime: null });
  });

  it("tells a rate limit from a refusal and an unknown symbol", () => {
    expect(classifyAnswer({ Information: "We have detected your API key as ... standard API rate limit is 25 requests per day." })).toMatchObject({ kind: "limit" });
    expect(classifyAnswer({ Note: "Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second)." })).toMatchObject({ kind: "limit" });
    expect(classifyAnswer({ Information: "This is a premium endpoint." })).toMatchObject({ kind: "refused" });
    expect(classifyAnswer({})).toEqual({ kind: "empty" });
    expect(classifyAnswer({ "Error Message": "Invalid API call." })).toEqual({ kind: "empty" });
    expect(classifyAnswer({ symbol: "X", quarterlyEarnings: [] })).toEqual({ kind: "empty" });
  });

  it("refuses an answer it cannot trust", () => {
    expect(() => classifyAnswer({ symbol: "X", quarterlyEarnings: [quarter("2026-09-30"), quarter("2026-09-30")] })).toThrow(/twice/);
    expect(() => classifyAnswer({ symbol: "X", quarterlyEarnings: [quarter("2026-9-30")] })).toThrow(/valid dates/);
    expect(() => classifyAnswer({ symbol: "X", quarterlyEarnings: [quarter("2026-09-30", { reportedEPS: "abc" })] })).toThrow(/Not a number/);
    expect(() => classifyAnswer({ symbol: "X" })).toThrow(/quarterlyEarnings/);
  });

  it("tries the other class separator", () => {
    expect(symbolsFor("brk.b")).toEqual(["BRK.B", "BRK-B"]);
    expect(symbolsFor("BF-B")).toEqual(["BF-B", "BF.B"]);
    expect(symbolsFor("AAPL")).toEqual(["AAPL"]);
  });
});

describe("which tickers a run asks for", () => {
  const registry = [{ cik: 3, ticker: "CCC" }, { cik: 1, ticker: "AAA" }, { cik: 2, ticker: "BBB" }, { cik: 4, ticker: "DDD" }];

  it("asks first for tickers without a stored answer, in ticker order, then the oldest copies", () => {
    const m = manifest({ BBB: stored(2, "BBB", "2026-11-20"), DDD: stored(4, "DDD", "2026-11-10") });
    expect(pickTickers(registry, m, "2026-11-25", 3).map(row => row.ticker)).toEqual(["AAA", "CCC", "DDD"]);
    expect(pickTickers(registry, m, "2026-11-25", 25).map(row => row.ticker)).toEqual(["AAA", "CCC", "DDD", "BBB"]);
  });

  it("does not ask again on the same day, and leaves an empty ticker alone for 30 days", () => {
    const m = manifest({ AAA: stored(1, "AAA", "2026-11-25"), BBB: { cik: 2, ticker: "BBB", symbol: null, files: [], empty: ["2026-11-10"] }, CCC: { cik: 3, ticker: "CCC", symbol: null, files: [], empty: ["2026-10-01"] } });
    expect(pickTickers(registry, m, "2026-11-25", 25).map(row => row.ticker)).toEqual(["CCC", "DDD"]);
  });
});
