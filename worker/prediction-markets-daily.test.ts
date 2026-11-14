import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDailyCollection } from "./prediction-markets-daily.mts";
import type { PredictionSources } from "./lib/prediction-market-sources";
import { memoryPredictionStore } from "./lib/prediction-market-storage";
import { KALSHI_CANDLE_RESPONSE, KALSHI_COMPANY_SETTLED, KALSHI_CPI_RESPONSE, KALSHI_FED_RESPONSE, KALSHI_RECESSION_MARKET, POLY_CPI_EVENT, POLY_FED_EVENT, POLY_HISTORY_RESPONSE, POLY_RECESSION_EVENT, POLY_SETTLED_EVENT } from "../src/test-fixtures/prediction-markets/responses";

const NOW = "2026-11-14T00:00:00.000Z";
const registry = { BBY: { cik: 764478, name: "Best Buy Co., Inc." }, CMG: { cik: 1058090, name: "Chipotle Mexican Grill, Inc." } };
const openBby = { ...KALSHI_COMPANY_SETTLED, ticker: "KXBBY-26NOVDOMCOMP-8", event_ticker: "KXBBY-26NOVDOMCOMP", title: "Will Best Buy Co., Inc. report Above 8% domestic comparable store sales in Q3 2027?", status: "active", floor_strike: 8, result: "", expiration_value: "", close_time: "2027-03-24T05:00:00Z" };
const inactiveBby = { ...openBby, ticker: "KXBBY-26NOVDOMCOMP-12", title: "Will Best Buy Co., Inc. report Above 12% domestic comparable store sales in Q4 2027?", status: "inactive", floor_strike: 12 };

function sources(settledPoly = false): PredictionSources {
  return {
    async series() {
      return [
        { ticker: "KXBBY", title: "Best Buy Co., Inc. domestic comparable store sales", category: "Companies" },
        { ticker: "KXCMG", title: "Best Buy Co., Inc. domestic comparable store sales", category: "Financials" },
        { ticker: "KXFED", title: "Fed decisions", category: "Macro" },
        { ticker: "KXCPI", title: "CPI", category: "Macro" },
        { ticker: "KXRECSSNBER", title: "US recession", category: "Macro" },
      ];
    },
    async markets(series) {
      if (series === "KXBBY") return [openBby, inactiveBby, KALSHI_COMPANY_SETTLED];
      if (series === "KXCMG") return [openBby];
      if (series === "KXFED") return KALSHI_FED_RESPONSE.markets;
      if (series === "KXCPI") return KALSHI_CPI_RESPONSE.markets;
      if (series === "KXRECSSNBER") return [KALSHI_RECESSION_MARKET];
      return [];
    },
    async candles(series, market) {
      expect(series).toBe("KXBBY");
      expect(market.ticker).toBe(KALSHI_COMPANY_SETTLED.ticker);
      return KALSHI_CANDLE_RESPONSE.candlesticks;
    },
    async polyEvents(topic) {
      if (topic === "fed") return [settledPoly ? POLY_SETTLED_EVENT : POLY_FED_EVENT];
      if (topic === "cpi") return [POLY_CPI_EVENT];
      if (topic === "recession") return [POLY_RECESSION_EVENT];
      return [];
    },
    async polyEvent(slug) { throw new Error(`Unexpected event detail request: ${slug}`); },
    async polyHistory(token) {
      expect(token).toBe("poly-settled-nochange");
      return POLY_HISTORY_RESPONSE.history;
    },
  };
}

function input(settledPoly = false) {
  const memory = memoryPredictionStore(), root = "D:/fixture-prediction-markets";
  memory.files.set(path.join(root, "kalshi", "daily-state.jsonl"), "{\"date\":\"2026-11-12\",\"fedNow\":4}\n");
  return { ...memory, options: { root, sources: sources(settledPoly), store: memory.store, registry, now: () => new Date(NOW), day: "2026-11-13", publicReportFile: path.join(root, "ui.json") } };
}

describe("daily prediction-market collection on recorded responses", () => {
  it("runs manually and in scheduled style without duplicate snapshots", async () => {
    const { options, files } = input();
    const first = await runDailyCollection(options);
    expect(first.status).toBe("complete");
    expect(first.invocation).toBe("manual");
    expect(first.counts).toMatchObject({ kalshiCompany: 3, kalshiMacro: 16, polymarketMacro: 11, settledHistories: 1, cachedHistories: 0, missingHistories: 0, errors: 0, quarantine: 0 });
    expect(first.mapping).toMatchObject({ acceptedSeries: 1, companies: 1, rejectedSeries: 1, status: "complete" });
    const mapping = JSON.parse(files.get(first.mapping.file)!);
    expect(mapping.accepted[0]).toMatchObject({ series: "KXBBY", ticker: "BBY", cik: 764478, kind: "business", markets: 3, open: 1, settled: 1 });
    expect(mapping.rejected[0]).toMatchObject({ series: "KXCMG", byTicker: "CMG", named: ["BBY"] });
    const dailyCompany = path.join(options.root, "daily", options.day, "kalshi-companies.jsonl");
    expect(files.get(dailyCompany)!.trim().split("\n")).toHaveLength(3);
    const settledRow = files.get(dailyCompany)!.trim().split("\n").map(line => JSON.parse(line)).find(row => row.result === "yes");
    expect(settledRow).toMatchObject({ ticker: "BBY", kind: "business", settlementValue: 4.5, result: "yes" });
    const candles = JSON.parse(files.get(path.join(options.root, settledRow.historyFile))!);
    expect(candles.candles).toHaveLength(2);
    expect(candles.ticker).toBe(KALSHI_COMPANY_SETTLED.ticker);
    const pending = files.get(dailyCompany)!.trim().split("\n").map(line => JSON.parse(line)).find(row => row.status === "inactive");
    expect(pending).toMatchObject({ status: "inactive", result: null });
    expect(pending.historyFile).toBeUndefined();
    const state = files.get(path.join(options.root, "kalshi", "daily-state.jsonl"))!.trim().split("\n");
    expect(state).toHaveLength(2);
    expect(JSON.parse(state[0])).toEqual({ date: "2026-11-12", fedNow: 4 });
    expect(JSON.parse(state[1])).toMatchObject({ date: "2026-11-13", fedNow: 4, recessionThisYear: 0.22 });
    expect(JSON.parse(files.get(path.join(options.root, "ui.json"))!).fed.outcomes.unchanged.primary).toBeCloseTo(0.63);
    const second = await runDailyCollection({ ...options, scheduledStyle: true });
    expect(second.status).toBe("complete");
    expect(second.invocation).toBe("scheduled-style");
    expect(second.counts).toMatchObject({ settledHistories: 0, cachedHistories: 1, errors: 0, quarantine: 0 });
    expect(files.get(dailyCompany)!.trim().split("\n")).toHaveLength(3);
    expect(files.get(path.join(options.root, "daily", options.day, "kalshi-macro.jsonl"))!.trim().split("\n")).toHaveLength(16);
    expect(files.get(path.join(options.root, "daily", options.day, "polymarket-macro.jsonl"))!.trim().split("\n")).toHaveLength(11);
    expect(second.runId).not.toBe(first.runId);
    expect(second.artifacts["daily-state.jsonl"]).toBe(first.artifacts["daily-state.jsonl"]);
  });

  it("captures a settled market and its full daily price history", async () => {
    const { options, files } = input(true);
    const manifest = await runDailyCollection(options);
    expect(manifest.status).toBe("complete");
    expect(manifest.counts.polymarketMacro).toBe(8);
    const rows = files.get(path.join(options.root, "daily", options.day, "polymarket-macro.jsonl"))!.trim().split("\n").map(line => JSON.parse(line));
    const settled = rows.find(row => row.result === "yes");
    expect(settled).toMatchObject({ result: "yes", settlementValue: 1, status: "closed" });
    expect(settled.historyFile).toBe(path.join(options.root, "polymarket", "fed-decisions.json"));
    const history = JSON.parse(files.get(settled.historyFile)!);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ event: "fed-decision-in-december-2026", change: 0, resolvedYes: true });
    expect(history[0].history).toEqual(POLY_HISTORY_RESPONSE.history);
  });

  it("preserves the previous mapping when a series fetch fails", async () => {
    const { options, files } = input();
    const failing = { ...options, sources: { ...options.sources, markets: async (series: string) => { if (series === "KXBBY") throw new Error("recorded series failure"); return options.sources.markets(series); } } };
    const manifest = await runDailyCollection(failing);
    expect(manifest.status).toBe("partial");
    expect(manifest.mapping.status).toBe("previous_preserved");
    expect(manifest.mapping.acceptedSeries).toBe(0);
    expect(manifest.errors[0].scope).toBe("company series KXBBY");
    expect(files.has(manifest.mapping.file)).toBe(false);
    expect(manifest.counts.kalshiMacro).toBe(16);
  });
});
