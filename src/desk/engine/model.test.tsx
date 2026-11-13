import { describe, expect, it } from "vitest";
import type { EngineDecision, EngineFlowCompany } from "@contracts/engine-flow";
import { cellEvidence, combine, decide, decodeFactor, errorRates, expit, factorLabel, FIGURE_FORMULAS, holding, logit, phi, scoreOf, shrink, tradeOf, usualRate } from "./model";

// six cells of [falls, rises]: said fall weak/medium/strong, said rise weak/medium/strong
const TABLE: [number, number][] = [[40, 30], [30, 20], [20, 10], [30, 40], [20, 30], [10, 20]];

describe("the engine's arithmetic on the Engine page", () => {
  it("computes the filed-figure readings as step 2 did, on Apple's 10-Q for the quarter ending 2019-03-30", () => {
    // what step 2 read (now, a year ago) and the readings it stored, to six decimals
    const pairs: Record<string, [number, number] | null> = {
      revenue: [58015e6, 61137e6], netIncome: [11561e6, 13822e6], operatingIncome: [13415e6, 15894e6], grossProfit: [21821e6, 23422e6],
      assets: [341998e6, 367502e6], liabilities: [236138e6, 240624e6], netIncome12: [57170e6, 53318e6], cfo12: [71856e6, 67844e6],
      capex12: [12026e6, 13147e6], revenue12: null, buybacks12: [72385e6, 47739e6], dividends12: [14194e6, 13164e6],
      inventory: [4884e6, 7662e6], receivables: [15085e6, 14324e6], rnd: [3948e6, 3378e6], sga: [4458e6, 4150e6], shares: [4700646000, 5068493000], deferredRevenue: null,
    };
    const stored: Record<string, number | null> = {
      revenueGrowth: -0.051066, earningsChange: -0.006152, grossMarginChange: -0.00698, operatingMarginChange: -0.02874, netMarginChange: -0.026806,
      accruals: -0.042942, cashFlowChange: 0.010917, assetGrowth: -0.069398, shareCountChange: -0.072575, liabilityRatioChange: 0.03571,
      inventoryVersusSales: -0.311503, receivablesVersusSales: 0.104193, deferredRevenueVersusSales: null, cashMarginChange: null,
    };
    for (const [name, value] of Object.entries(stored)) {
      const computed = FIGURE_FORMULAS[name].compute(pairs);
      if (value === null) expect(computed, name).toBeNull();
      else expect(Math.abs((computed ?? NaN) - value), name).toBeLessThan(1e-6);
    }
  });

  it("names factors in words, with their basis", () => {
    expect(factorLabel("reaction")).toBe("First-session reaction");
    expect(factorLabel("revenueGrowth.trend")).toBe("Revenue growth, against its own record");
    expect(factorLabel("accruals.peer")).toBe("Accruals (profit not backed by cash), against peers");
  });

  it("reads e+ and e− from a factor's table", () => {
    const rates = errorRates(TABLE);
    // falls 150, rises 150; said rise and fell 60, said fall and rose 60
    expect(rates.falls).toBe(150);
    expect(rates.rises).toBe(150);
    expect(rates.ePlus).toBeCloseTo(60 / 150, 12);
    expect(rates.eMinus).toBeCloseTo(60 / 150, 12);
    expect(rates.hitRise).toBeCloseTo(90 / 150, 12);
    expect(rates.hitFall).toBeCloseTo(90 / 150, 12);
  });

  it("computes a cell's evidence as step 3 does, with its variance", () => {
    const strongRise = cellEvidence(TABLE, 5);
    expect(strongRise.a).toBe(20);
    expect(strongRise.b).toBe(10);
    expect(strongRise.e).toBeCloseTo(Math.log((20.5 / 153) / (10.5 / 153)), 12);
    expect(strongRise.v).toBeCloseTo(1 / 20.5 - 1 / 153 + 1 / 10.5 - 1 / 153, 12);
    expect(shrink(0.5, 0.1, 0.1)).toBeCloseTo(0.25, 12);
    expect(shrink(0.5, 0.1, 0)).toBe(0);
  });

  it("combines the factors in log-odds from the usual rate, dividing each by its k", () => {
    expect(usualRate([99, 101])).toBeCloseTo(102 / 202, 12);
    const result = combine(0.5, [
      { kept: 0.2, k: 2, status: 0 },
      { kept: -0.1, k: 1, status: 0 },
      { kept: 0.9, k: 1, status: 4 },
    ]);
    expect(result.terms).toEqual([0.1, -0.1]);
    expect(result.p).toBeCloseTo(0.5, 12);
    expect(expit(logit(0.37))).toBeCloseTo(0.37, 12);
    expect(phi(0)).toBeCloseTo(0.5, 7);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
  });

  it("decodes a traced factor row", () => {
    const row = [2, 0.31, 1.2, 800, 700, 0.05, 0.01, 1, 2, ...TABLE.flat(), 0.7, 0.14, 0.02, 0.087, 1.3, 0];
    const factor = decodeFactor(row, ["reaction", "drift", "mom12"], ["price", "price", "price"]);
    expect(factor.name).toBe("mom12");
    expect(factor.side).toBe(1);
    expect(factor.level).toBe(2);
    expect(factor.table?.[5]).toEqual([10, 20]);
    expect(factor.kept).toBe(0.087);
    expect(factor.why).toBe("votes");
  });

  it("trades only when the engine leans far enough, and scores against the usual rate and the benchmarks", () => {
    const decision = (id: string, date: string, p: number, up: 0 | 1, r: number, s: number): EngineDecision => ({
      id, kind: "release", date, periodEnd: date, form: "10-Q", accession: id, published: date, release: date, filed: date, firstSession: date, lastDate: date, sameDay: false,
      sigma: { r: 0.02, c: 0.015, a: 0.01, m: 0.01 }, px: {}, figures: null, inputs: null,
      out: { "10": { r, s, m: 0, days: 10, exit: `${date.slice(0, 8)}28` } },
      trace: { "10": { base: [50, 50], prior: 0.5, p: { graded: p, table: p, soft: p, joint: p }, out: [up, up ? 1 : -1, date], f: [] } },
    });
    const company = {
      schemaVersion: 1, cik: 1, ticker: "X", name: "X", sector: "S", sectorFund: "XLK", facts: { concepts: [], rows: [] },
      prices: { dates: ["2020-01-03", "2020-12-31"], stock: [0, Math.log(1.2)], fund: [0, Math.log(1.1)], market: [0, Math.log(1.05)] },
      decisions: [decision("a", "2020-01-10", 0.58, 1, 0.05, 0.01), decision("b", "2020-04-10", 0.47, 1, 0.02, 0.03), decision("c", "2020-07-10", 0.42, 0, -0.04, 0.0)],
    } as EngineFlowCompany;
    const rule = { lean: 0.05, cost: 0.001 };
    expect(decide(company.decisions[0].trace["10"], rule).action).toBe("long");
    expect(decide(company.decisions[1].trace["10"], rule).action).toBe("none");
    expect(tradeOf(company.decisions[2], "10", rule)).toMatchObject({ side: -1, gross: 0.04, won: true });
    const score = scoreOf(company, "release", "10", rule);
    expect(score.decisions).toBe(3);
    expect(score.trades).toBe(2);
    expect(score.won).toBe(1);
    expect(score.meanGross).toBeCloseTo((0.04 + 0.04) / 2, 12);
    expect(score.totalNet).toBeCloseTo(0.08 - 0.002, 12);
    expect(score.alwaysLong).toBeCloseTo((0.04 - 0.01 - 0.04) / 3, 12);
    expect(score.gainPer1000).toBeCloseTo((1000 * (Math.log(0.58 / 0.5) + Math.log(0.47 / 0.5) + Math.log(0.58 / 0.5))) / 3, 9);
    expect(score.curve.at(-1)?.rule).toBeCloseTo(0.078, 12);
    expect(holding(company, "2020-01-01", "2021-01-01").stock).toBeCloseTo(0.2, 12);
  });
});
