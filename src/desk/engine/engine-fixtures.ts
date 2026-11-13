/**
 * A small engine-flow index and company for the desk's tests, built with the engine's own formulas so that every worked
 * example on the page checks out: three traced release decisions (one buys, one does nothing, one sells) and a filing.
 */
import type { EngineDecision, EngineFlowCompany, EngineFlowIndex } from "@contracts/engine-flow";
import { cellEvidence, expit, logit, shrink } from "./model";

// tables of earlier forecasts, [falls, rises] for: said fall weak, medium, strong; said rise weak, medium, strong
type Table = [number, number][];
export const TABLES: Record<"buy" | "flat" | "sell", Table> = {
  buy: [[300, 200], [250, 200], [200, 150], [200, 250], [200, 250], [150, 300]],
  flat: [[200, 200], [200, 200], [200, 200], [200, 200], [200, 200], [200, 200]],
  sell: [[200, 250], [250, 200], [300, 150], [200, 250], [200, 200], [150, 200]],
};
const SPREAD = 0.05, K = 1.2;

/** One voting factor's traced row, its evidence and kept evidence computed as step 3 does. */
function voting(factor: number, raw: number, z: number, side: 0 | 1, level: 0 | 1 | 2, table: Table) {
  const { e, v } = cellEvidence(table, side * 3 + level);
  const kept = shrink(e, v, SPREAD);
  return { row: [factor, raw, z, 900, 800, 0.02, 0.01, side, level, ...table.flat(), e, v, SPREAD, kept, K, 0], term: kept / K };
}

function release(date: string, kind: "buy" | "flat" | "sell", up: 0 | 1, r: number, s: number): EngineDecision {
  const prior = 0.5;
  const vote = kind === "sell" ? voting(0, -1.2, -1.1, 0, 2, TABLES.sell) : voting(0, 1.2, 1.1, 1, 2, TABLES[kind]);
  const p = expit(logit(prior) + vote.term);
  return {
    id: `TEST|${date}|release`, kind: "release", date, periodEnd: date, form: "10-Q", accession: `0000000001-${date.slice(2, 4)}-000001`,
    published: `${date}T08:00:00`, release: `${date}T08:00:00`, filed: `${date}T16:00:00`, firstSession: date, lastDate: date, sameDay: false,
    sigma: { r: 0.02, c: 0.015, a: 0.01, m: 0.009 },
    px: { reaction: kind === "sell" ? -1.2 : 1.2, drift: null, mom12: 0.4, mom6: -0.2, runUp: 0.3, volRatio: 0.1, high52: -0.05 },
    figures: null, inputs: null,
    out: { "10": { r, s, m: 0.01, days: 10, exit: `${date.slice(0, 8)}25` } },
    trace: {
      "10": {
        base: [5049, 5049], prior, p: { graded: p, table: p, soft: prior, joint: prior }, out: [up, up ? 0.8 : -0.8, `${date.slice(0, 8)}25`],
        f: [vote.row, [6, -0.05, null, 20, null, null, null, null, null, ...new Array(12).fill(null), null, null, null, null, null, 1]],
      },
    },
  };
}

const filing: EngineDecision = {
  ...release("2024-08-05", "flat", 1, 0.02, 0.01),
  id: "TEST|2024-06-30|filing", kind: "filing", periodEnd: "2024-06-30",
  figures: { revenueGrowth: 0.05, "revenueGrowth.trend": 0.5, "revenueGrowth.peer": 0.01 },
  inputs: { pairs: { revenue: [105e9, 100e9] }, trend: { revenueGrowth: [0.04, 0.02, 8] }, peer: { revenueGrowth: [0.04, 30] } },
};

// a decision past the sealed line: the builder keeps its forecast and withholds its outcome
const sealedRelease: EngineDecision = (() => {
  const decision = release("2026-07-30", "buy", 1, 0.04, 0.01);
  return { ...decision, out: { "10": null }, trace: { "10": { ...decision.trace["10"], out: null } }, sealed: true };
})();

export const ENGINE_COMPANY: EngineFlowCompany = {
  schemaVersion: 1, cik: 99, ticker: "TEST", name: "Test Corp", sector: "Information Technology", sectorFund: "XLK",
  facts: { concepts: ["Revenues", "NetIncomeLoss"], rows: [[0, "2024-04-01", "2024-06-30", 105e9, "2024-08-02", "0000000001-24-000001", "10-Q"], [1, "2024-04-01", "2024-06-30", 20e9, "2024-08-02", "0000000001-24-000001", "10-Q"]] },
  prices: { dates: ["2023-01-06", "2024-01-05", "2025-01-03"], stock: [0, 0.1, 0.2], fund: [0, 0.05, 0.1], market: [0, 0.04, 0.08] },
  decisions: [
    release("2023-05-01", "flat", 0, -0.01, 0),
    release("2023-08-01", "buy", 1, 0.05, 0.01),
    release("2024-08-01", "sell", 0, -0.03, 0.01),
    filing,
    sealedRelease,
  ],
};

export const ENGINE_INDEX: EngineFlowIndex = {
  schemaVersion: 1, generatedAt: "2026-11-12T00:00:00.000Z",
  run: { folder: "test", name: "engine v1 (test)", scored: ["2013-01-01", "2026-07-01"] },
  horizons: ["5", "10", "20", "45"],
  factors: { release: ["reaction", "drift", "mom12", "mom6", "runUp", "volRatio", "high52"], filing: ["reaction", "drift", "mom12", "mom6", "runUp", "volRatio", "high52"], families: { release: new Array(7).fill("price"), filing: new Array(7).fill("price") } },
  overall: [{ kind: "release", h: "10", decisions: 19142, gain: -0.12, low: -0.4, high: 0.2, leaned: 0, won: null }],
  companies: [{ cik: 99, ticker: "TEST", name: "Test Corp", sector: "Information Technology", decisions: 5, traced: 5, first: "2023-05-01", last: "2026-07-30" }],
};
