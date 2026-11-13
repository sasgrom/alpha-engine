/**
 * The arithmetic of the Engine page: decoding a factor's traced working, the formulas of engine v1 recomputed from the
 * traced numbers (so each worked example can be checked against what the engine itself produced), the trading rule,
 * and the scoring against the benchmarks. Pure functions, tested in model.test.tsx.
 */
import { FACTOR_ROW, FACTOR_STATUS, type EngineDecision, type EngineFactorRow, type EngineFlowCompany, type EngineTrace } from "@contracts/engine-flow";

// ---- normal distribution ------------------------------------------------------------------------------------------
/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26, error under 1.5e-7). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
export const logit = (p: number) => Math.log(p / (1 - p));
export const expit = (x: number) => 1 / (1 + Math.exp(-x));

// ---- factors ---------------------------------------------------------------------------------------------------------
const PRICE_LABELS: Record<string, string> = {
  reaction: "First-session reaction",
  drift: "Drift since the first session",
  mom12: "12-month momentum",
  mom6: "6-month momentum",
  runUp: "Run-up into the publication",
  volRatio: "Recent volatility against usual",
  high52: "Distance below the 52-week high",
};
const FIGURE_LABELS: Record<string, string> = {
  revenueGrowth: "Revenue growth",
  earningsChange: "Change in quarterly profit",
  grossMarginChange: "Gross margin change",
  operatingMarginChange: "Operating margin change",
  netMarginChange: "Net margin change",
  accruals: "Accruals (profit not backed by cash)",
  cashFlowChange: "Operating cash flow change",
  assetGrowth: "Asset growth",
  shareCountChange: "Share count change",
  liabilityRatioChange: "Liabilities to assets, change",
  inventoryVersusSales: "Inventory growth over sales growth",
  receivablesVersusSales: "Receivables growth over sales growth",
  researchIntensityChange: "R&D intensity change",
  overheadChange: "Overhead (SG&A) intensity change",
  capexGrowth: "Capital spending growth",
  payoutChange: "Payout (buybacks and dividends) change",
  deferredRevenueVersusSales: "Deferred revenue growth over sales growth",
  cashMarginChange: "Cash margin change",
};

export function factorLabel(name: string): string {
  const [base, basis] = name.split(".");
  const label = PRICE_LABELS[base] ?? FIGURE_LABELS[base] ?? base;
  return basis === "trend" ? `${label}, against its own record` : basis === "peer" ? `${label}, against peers` : label;
}
export const isPriceFactor = (name: string) => name.split("@")[0] in PRICE_LABELS;

export interface FactorView {
  name: string;
  family: string;
  raw: number | null;
  z: number | null;
  earlier: number;
  n: number | null;
  slope: number | null;
  intercept: number | null;
  side: 0 | 1 | null;
  level: 0 | 1 | 2 | null;
  /** [falls, rises] for the six cells: said fall weak, medium, strong; said rise weak, medium, strong. */
  table: [number, number][] | null;
  evidence: number | null;
  variance: number | null;
  spread: number | null;
  kept: number | null;
  k: number | null;
  status: number;
  why: string;
}

export function decodeFactor(row: EngineFactorRow, names: string[], families: string[]): FactorView {
  const at = (i: number) => row[i] ?? null;
  const table = at(FACTOR_ROW.table) === null ? null : [0, 1, 2, 3, 4, 5].map((c) => [row[FACTOR_ROW.table + 2 * c] ?? 0, row[FACTOR_ROW.table + 2 * c + 1] ?? 0] as [number, number]);
  const index = at(FACTOR_ROW.factor) ?? 0;
  const status = at(FACTOR_ROW.status) ?? 1;
  return {
    name: names[index] ?? `factor ${index}`,
    family: families[index] ?? "",
    raw: at(FACTOR_ROW.raw),
    z: at(FACTOR_ROW.z),
    earlier: at(FACTOR_ROW.earlier) ?? 0,
    n: at(FACTOR_ROW.n),
    slope: at(FACTOR_ROW.slope),
    intercept: at(FACTOR_ROW.intercept),
    side: at(FACTOR_ROW.side) as 0 | 1 | null,
    level: at(FACTOR_ROW.level) as 0 | 1 | 2 | null,
    table,
    evidence: at(FACTOR_ROW.evidence),
    variance: at(FACTOR_ROW.variance),
    spread: at(FACTOR_ROW.spread),
    kept: at(FACTOR_ROW.kept),
    k: at(FACTOR_ROW.k),
    status,
    why: FACTOR_STATUS[status] ?? "unknown",
  };
}

// ---- the filed-figure readings of step 2 ----------------------------------------------------------------------------
export type FigurePairs = Record<string, [number, number] | null>;
const growth = (pair: [number, number] | null | undefined) => (pair && pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] - 1 : null);
const ratioChange = (top: [number, number] | null | undefined, bottom: [number, number] | null | undefined) => (top && bottom && bottom[0] > 0 && bottom[1] > 0 ? top[0] / bottom[0] - top[1] / bottom[1] : null);
const less = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);

/** How each filed-figure reading is computed from the pairs (now, a year ago) step 2 read. */
export const FIGURE_FORMULAS: Record<string, { uses: string[]; formula: string; compute: (p: FigurePairs) => number | null }> = {
  revenueGrowth: { uses: ["revenue"], formula: "revenue now / revenue a year ago − 1", compute: (p) => growth(p.revenue) },
  earningsChange: { uses: ["netIncome", "assets"], formula: "(net income now − a year ago) / assets a year ago", compute: (p) => (p.netIncome && p.assets && p.assets[1] > 0 ? (p.netIncome[0] - p.netIncome[1]) / p.assets[1] : null) },
  grossMarginChange: { uses: ["grossProfit", "revenue"], formula: "gross profit / revenue, now minus a year ago", compute: (p) => ratioChange(p.grossProfit, p.revenue) },
  operatingMarginChange: { uses: ["operatingIncome", "revenue"], formula: "operating income / revenue, now minus a year ago", compute: (p) => ratioChange(p.operatingIncome, p.revenue) },
  netMarginChange: { uses: ["netIncome", "revenue"], formula: "net income / revenue, now minus a year ago", compute: (p) => ratioChange(p.netIncome, p.revenue) },
  accruals: { uses: ["netIncome12", "cfo12", "assets"], formula: "(net income − operating cash flow, last 12 months) / assets", compute: (p) => (p.netIncome12 && p.cfo12 && p.assets && p.assets[0] > 0 ? (p.netIncome12[0] - p.cfo12[0]) / p.assets[0] : null) },
  cashFlowChange: { uses: ["cfo12", "assets"], formula: "(operating cash flow 12m now − a year ago) / assets a year ago", compute: (p) => (p.cfo12 && p.assets && p.assets[1] > 0 ? (p.cfo12[0] - p.cfo12[1]) / p.assets[1] : null) },
  assetGrowth: { uses: ["assets"], formula: "assets now / a year ago − 1", compute: (p) => growth(p.assets) },
  shareCountChange: { uses: ["shares"], formula: "diluted shares now / a year ago − 1", compute: (p) => growth(p.shares) },
  liabilityRatioChange: { uses: ["liabilities", "assets"], formula: "liabilities / assets, now minus a year ago", compute: (p) => ratioChange(p.liabilities, p.assets) },
  inventoryVersusSales: { uses: ["inventory", "revenue"], formula: "inventory growth − revenue growth", compute: (p) => less(growth(p.inventory), growth(p.revenue)) },
  receivablesVersusSales: { uses: ["receivables", "revenue"], formula: "receivables growth − revenue growth", compute: (p) => less(growth(p.receivables), growth(p.revenue)) },
  researchIntensityChange: { uses: ["rnd", "revenue"], formula: "R&D / revenue, now minus a year ago", compute: (p) => ratioChange(p.rnd, p.revenue) },
  overheadChange: { uses: ["sga", "revenue"], formula: "SG&A / revenue, now minus a year ago", compute: (p) => ratioChange(p.sga, p.revenue) },
  capexGrowth: { uses: ["capex12"], formula: "capital spending 12m now / a year ago − 1", compute: (p) => growth(p.capex12) },
  payoutChange: { uses: ["buybacks12", "dividends12", "assets"], formula: "(buybacks + dividends, 12m) / assets, now minus a year ago", compute: (p) => (p.assets && (p.buybacks12 || p.dividends12) ? ((p.buybacks12?.[0] ?? 0) + (p.dividends12?.[0] ?? 0)) / p.assets[0] - ((p.buybacks12?.[1] ?? 0) + (p.dividends12?.[1] ?? 0)) / p.assets[1] : null) },
  deferredRevenueVersusSales: { uses: ["deferredRevenue", "revenue"], formula: "deferred revenue growth − revenue growth", compute: (p) => less(growth(p.deferredRevenue), growth(p.revenue)) },
  cashMarginChange: { uses: ["cfo12", "revenue12"], formula: "operating cash flow / revenue (12m), now minus a year ago", compute: (p) => ratioChange(p.cfo12, p.revenue12) },
};

export const LEVELS = ["weak", "medium", "strong"] as const;
/** Thirds of a normal reading by size: |z| under 0.43 weak, under 0.97 medium, otherwise strong. */
export const levelOf = (z: number) => (Math.abs(z) < 0.43 ? 0 : Math.abs(z) < 0.97 ? 1 : 2);

/** The factor's place among the earlier readings, as a share (the rank-normal score's percentile). */
export const percentileOf = (z: number) => phi(z);

// ---- the factor's table: e+ and e− --------------------------------------------------------------------------------
export interface ErrorRates { saidRise: number; saidFall: number; rises: number; falls: number; ePlus: number | null; eMinus: number | null; hitRise: number | null; hitFall: number | null }
/**
 * From a factor's table of earlier forecasts: e+ is the share of the falls in which it had said "rise" (a false rise),
 * e− the share of the rises in which it had said "fall" (a missed rise). hitRise and hitFall are how often each side
 * came true.
 */
export function errorRates(table: [number, number][]): ErrorRates {
  const fallSide = table.slice(0, 3), riseSide = table.slice(3);
  const sum = (cells: [number, number][], at: 0 | 1) => cells.reduce((a, c) => a + c[at], 0);
  const falls = sum(table, 0), rises = sum(table, 1);
  const saidRise = sum(riseSide, 0) + sum(riseSide, 1), saidFall = sum(fallSide, 0) + sum(fallSide, 1);
  return {
    saidRise, saidFall, rises, falls,
    ePlus: falls ? sum(riseSide, 0) / falls : null,
    eMinus: rises ? sum(fallSide, 1) / rises : null,
    hitRise: saidRise ? sum(riseSide, 1) / saidRise : null,
    hitFall: saidFall ? sum(fallSide, 0) / saidFall : null,
  };
}

/**
 * The evidence of one cell, as step 3 computes it: the log of how much likelier this forecast is before a rise than
 * before a fall, each count smoothed by a half, and its sampling variance.
 *   e = ln( ((a + ½) / (U + 3)) / ((b + ½) / (D + 3)) ),  v = 1/(a + ½) − 1/(U + 3) + 1/(b + ½) − 1/(D + 3)
 * a, b: rises and falls after this cell's forecasts; U, D: all rises and falls after this factor's forecasts.
 */
export function cellEvidence(table: [number, number][], cell: number): { a: number; b: number; up: number; down: number; e: number; v: number } {
  const up = table.reduce((s, c) => s + c[1], 0), down = table.reduce((s, c) => s + c[0], 0);
  const [b, a] = table[cell];
  const e = Math.log(((a + 0.5) / (up + 3)) / ((b + 0.5) / (down + 3)));
  const v = 1 / (a + 0.5) - 1 / (up + 3) + 1 / (b + 0.5) - 1 / (down + 3);
  return { a, b, up, down, e, v };
}

/** Shrinking toward "no information": the evidence keeps the share spread / (spread + variance) of its value. */
export const shrink = (e: number, v: number, spread: number) => (spread > 0 ? (e * spread) / (spread + v) : 0);

/** The usual rate: how often the target has risen so far, (rises + 1) / (all + 2). */
export const usualRate = (base: [number, number]) => (base[1] + 1) / (base[0] + base[1] + 2);

/** Bayes in log-odds: start from the usual rate and add each voting factor's kept evidence divided by its k. */
export function combine(prior: number, factors: { kept: number | null; k: number | null; status: number }[]): { terms: number[]; logOdds: number; p: number } {
  const terms = factors.filter((f) => f.status === 0 && f.kept !== null).map((f) => (f.kept ?? 0) / (f.k && f.k > 0 ? f.k : 1));
  const logOdds = logit(prior) + terms.reduce((a, b) => a + b, 0);
  return { terms, logOdds, p: expit(logOdds) };
}

// ---- the trading rule ----------------------------------------------------------------------------------------------
export interface Rule { lean: number; cost: number }
export interface Trade { id: string; date: string; exit: string; side: 1 | -1; lean: number; gross: number; net: number; won: boolean }
export type Choice = { action: "none"; lean: number } | { action: "long" | "short"; lean: number };

/** The decision tree: lean = p − usual rate; at least `lean` up: long the company against its sector fund; at least `lean` down: the reverse; otherwise no trade. */
export function decide(trace: EngineTrace, rule: Rule): Choice {
  const lean = trace.p.graded - trace.prior;
  if (lean >= rule.lean) return { action: "long", lean };
  if (lean <= -rule.lean) return { action: "short", lean };
  return { action: "none", lean };
}

/** The trade a decision makes, entered at its close and closed after the horizon: the company's return minus the sector fund's, signed. */
export function tradeOf(decision: EngineDecision, h: string, rule: Rule): Trade | null {
  const trace = decision.trace[h], out = decision.out[h];
  if (!trace || !out) return null;
  const choice = decide(trace, rule);
  if (choice.action === "none") return null;
  const side = choice.action === "long" ? 1 : -1;
  const gross = side * (out.r - out.s);
  return { id: decision.id, date: decision.date, exit: out.exit, side, lean: choice.lean, gross, net: gross - rule.cost, won: gross > 0 };
}

// ---- scoring --------------------------------------------------------------------------------------------------------
const clip = (p: number) => Math.min(0.999, Math.max(0.001, p));
/** Log-score gain of a probability over the usual rate for one outcome (the engine's main yardstick), in nats. */
export const logGain = (p: number, prior: number, up: number) => Math.log(up ? clip(p) / clip(prior) : (1 - clip(p)) / (1 - clip(prior)));

export interface Score {
  decisions: number;
  gainPer1000: number | null;
  brierEngine: number | null;
  brierUsual: number | null;
  upShare: number | null;
  trades: number;
  won: number | null;
  meanGross: number | null;
  meanNet: number | null;
  totalNet: number;
  alwaysLong: number | null;
  /** Running totals by exit date, for the equity curve: the rule's trades, and being long the company against its fund every time. */
  curve: { date: string; rule: number; always: number }[];
}

/** The engine's record for a company's decisions of one kind at one horizon, from `from` to `to` (exclusive). */
export function scoreOf(company: EngineFlowCompany, kind: string, h: string, rule: Rule, from = "0000", to = "9999"): Score {
  let n = 0, gain = 0, brierE = 0, brierU = 0, ups = 0, trades = 0, wins = 0, gross = 0, net = 0, always = 0, alwaysN = 0;
  const points: { date: string; rule: number; always: number }[] = [];
  for (const decision of company.decisions) {
    if (decision.kind !== kind || decision.date < from || decision.date >= to) continue;
    const trace = decision.trace[h], out = decision.out[h];
    if (!trace || !trace.out || !out) continue;
    const up = trace.out[0];
    n++;
    ups += up;
    gain += logGain(trace.p.graded, trace.prior, up);
    brierE += (trace.p.graded - up) ** 2;
    brierU += (trace.prior - up) ** 2;
    always += out.r - out.s;
    alwaysN++;
    const trade = tradeOf(decision, h, rule);
    if (trade) {
      trades++;
      if (trade.won) wins++;
      gross += trade.gross;
      net += trade.net;
    }
    points.push({ date: out.exit, rule: trade ? trade.net : 0, always: out.r - out.s });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  let runRule = 0, runAlways = 0;
  const curve = points.map((point) => ({ date: point.date, rule: (runRule += point.rule), always: (runAlways += point.always) }));
  return {
    decisions: n,
    gainPer1000: n ? (1000 * gain) / n : null,
    brierEngine: n ? brierE / n : null,
    brierUsual: n ? brierU / n : null,
    upShare: n ? ups / n : null,
    trades,
    won: trades ? wins / trades : null,
    meanGross: trades ? gross / trades : null,
    meanNet: trades ? net / trades : null,
    totalNet: net,
    alwaysLong: alwaysN ? always / alwaysN : null,
    curve,
  };
}

/** Holding the stock, the sector fund and the market over a stretch of the weekly prices: total returns. */
export function holding(company: EngineFlowCompany, from: string, to: string): { stock: number | null; fund: number | null; market: number | null } {
  const { dates } = company.prices;
  const a = dates.findIndex((d) => d >= from);
  let b = dates.length - 1;
  while (b > 0 && dates[b] > to) b--;
  const change = (series: (number | null)[] | null) => {
    if (!series || a < 0 || b <= a) return null;
    let i = a, j = b;
    while (i < j && series[i] === null) i++;
    while (j > i && series[j] === null) j--;
    return series[i] !== null && series[j] !== null ? Math.exp((series[j] as number) - (series[i] as number)) - 1 : null;
  };
  return { stock: change(company.prices.stock), fund: change(company.prices.fund), market: change(company.prices.market) };
}
