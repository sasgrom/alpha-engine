/**
 * 6a — materialize first-vintage factor_points, then evaluate per-factor IC.
 * Fundamental availability is MAX(first-filed) across the exact concepts and
 * periods required by each history formula. Missing availability emits no row.
 */
import { eq, sql } from "drizzle-orm";
import { factorPoints } from "@db/schema";
import { getDb } from "../queries/connection";
import { computeCompanyFactors } from "./factors";
import { getBars } from "./prices";
import { excessForwardReturn, icStats, type IcPair } from "./ic";

const HORIZONS = [63, 126] as const; // ~1Q, ~2Q in trading days

export interface FactorPointWriteRow {
  cik: number;
  factor: string;
  periodEnd: string;
  filedAt: string;
  value: number | null;
}

type AvailabilityMap = ReadonlyMap<string, string | null>;
type Requirement = { concepts: readonly string[]; trailing: "point" | "ttm" | "debt" };
const SHARES = ["CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding"] as const;
const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalentsAtCarryingValueIncludingRestrictedCash"] as const;
const LONG_DEBT = ["LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"] as const;
const CURRENT_DEBT = ["DebtCurrent", "LongTermDebtCurrent"] as const;
const point = (...concepts: string[]): Requirement => ({ concepts, trailing: "point" });
const ttm = (...concepts: string[]): Requirement => ({ concepts, trailing: "ttm" });
const debt = (): Requirement => ({ concepts: [], trailing: "debt" });
const REQUIREMENTS: Record<string, Requirement[]> = {
  accruals: [point("NetIncomeLoss"), point("NetCashProvidedByUsedInOperatingActivities"), point("Assets")],
  grossProfitability: [point("GrossProfit"), point("Assets")],
  earningsYield: [ttm("NetIncomeLoss"), point(...SHARES)],
  bookToMarket: [point("StockholdersEquity"), point(...SHARES)],
  fcfYield: [ttm("NetCashProvidedByUsedInOperatingActivities"), ttm("PaymentsToAcquirePropertyPlantAndEquipment"), point(...SHARES)],
  salesYield: [ttm("RevenueFromContractWithCustomerExcludingAssessedTax"), point(...SHARES)],
  ocfYield: [ttm("NetCashProvidedByUsedInOperatingActivities"), point(...SHARES)],
  evEbitda: [ttm("OperatingIncomeLoss"), ttm("DepreciationDepletionAndAmortization"), point(...SHARES), debt(), point(...CASH)],
  evEbit: [ttm("OperatingIncomeLoss"), point(...SHARES), debt(), point(...CASH)],
  netDebtToEbitda: [ttm("OperatingIncomeLoss"), ttm("DepreciationDepletionAndAmortization"), point(...SHARES), debt(), point(...CASH)],
  peRatio: [ttm("NetIncomeLoss"), point(...SHARES)],
};

function conceptPeriods(concept: string, availability: AvailabilityMap): string[] {
  const suffix = `|${concept}`;
  const periods = new Set<string>();
  for (const key of availability.keys()) {
    if (key.startsWith(`${concept}|`)) periods.add(key.slice(concept.length + 1));
    else if (key.endsWith(suffix)) periods.add(key.slice(0, -suffix.length));
  }
  return [...periods].sort();
}

function maxAvailability(points: { concept: string; periodEnd: string }[], availability: AvailabilityMap): string | null {
  let latest = "";
  for (const point of points) {
    const key = `${point.concept}|${point.periodEnd}`;
    if (!availability.has(key)) return null;
    const filedAt = availability.get(key);
    if (!filedAt) return null;
    if (filedAt > latest) latest = filedAt;
  }
  return latest || null;
}

function pointAvailability(requirement: Requirement, periodEnd: string, availability: AvailabilityMap): string | null {
  const concept = requirement.concepts.find((candidate) => availability.has(`${candidate}|${periodEnd}`));
  return concept ? maxAvailability([{ concept, periodEnd }], availability) : null;
}

function ttmAvailability(requirement: Requirement, periodEnd: string, availability: AvailabilityMap): string | null {
  const concept = requirement.concepts[0];
  const periods = conceptPeriods(concept, availability).filter((candidate) => candidate <= periodEnd).slice(-4);
  return periods.length === 4 ? maxAvailability(periods.map((candidate) => ({ concept, periodEnd: candidate })), availability) : null;
}

function debtAvailability(periodEnd: string, availability: AvailabilityMap): string | null {
  const long = LONG_DEBT.find((concept) => availability.has(`${concept}|${periodEnd}`));
  const current = CURRENT_DEBT.find((concept) => availability.has(`${concept}|${periodEnd}`));
  if (!long && !current) return null;
  return maxAvailability([
    ...(long ? [{ concept: long, periodEnd }] : []),
    ...(current ? [{ concept: current, periodEnd }] : []),
  ], availability);
}

function requiredAvailability(factor: string, periodEnd: string, availability: AvailabilityMap): string | null {
  if (factor === "assetGrowth" || factor === "buybackYield") {
    const concept = factor === "assetGrowth" ? "Assets" : "CommonStockSharesOutstanding";
    const periods = conceptPeriods(concept, availability);
    const index = periods.indexOf(periodEnd);
    if (index < 4) return null;
    return maxAvailability([
      { concept, periodEnd },
      { concept, periodEnd: periods[index - 4] },
    ], availability);
  }
  if (factor === "sue") {
    const concept = "EarningsPerShareDiluted";
    const periods = conceptPeriods(concept, availability).reverse();
    const index = periods.indexOf(periodEnd);
    if (index < 0 || periods.length - index < 6) return null;
    return maxAvailability(periods.slice(index).map((candidate) => ({ concept, periodEnd: candidate })), availability);
  }
  const requirements = REQUIREMENTS[factor];
  if (!requirements) return null;
  let latest = "";
  for (const requirement of requirements) {
    const filedAt = requirement.trailing === "ttm"
      ? ttmAvailability(requirement, periodEnd, availability)
      : requirement.trailing === "debt"
        ? debtAvailability(periodEnd, availability)
        : pointAvailability(requirement, periodEnd, availability);
    if (!filedAt) return null;
    if (filedAt > latest) latest = filedAt;
  }
  return latest || null;
}

function displayFiledAt(value: string): string {
  return (value.length === 10 ? `${value} 00:00:00` : value.slice(0, 19)).replace("T", " ");
}

/** Map first-vintage history values to research rows without availability fallbacks. */
export function buildFactorPointRows(
  cik: number,
  detail: Record<string, { history: { t: string; v: number | null }[] }>,
  firstFiledByConceptPeriod: AvailabilityMap,
): FactorPointWriteRow[] {
  const out: FactorPointWriteRow[] = [];
  for (const [factor, det] of Object.entries(detail)) {
    const isMarketFactor = factor === "momentum122" || factor === "high52";
    for (const pt of det.history) {
      if (pt.v === null || !Number.isFinite(pt.v)) continue;
      const filedAt = isMarketFactor ? `${pt.t} 00:00:00` : requiredAvailability(factor, pt.t, firstFiledByConceptPeriod);
      if (!filedAt) continue;
      out.push({ cik, factor, periodEnd: pt.t, filedAt: displayFiledAt(filedAt), value: pt.v });
    }
  }
  return out;
}

/** Recompute first-vintage factor points with matching first-series availability. */
export async function materializeFactorPoints(cik: number): Promise<number> {
  const db = getDb();
  const [f, availabilityRaw]: [any, any] = await Promise.all([
    computeCompanyFactors(cik, "first"),
    db.execute(sql`SELECT concept, periodEnd, sourceFiled, val FROM series_points WHERE cik=${cik} AND vintage='first'`),
  ]);
  const firstFiled = new Map<string, string | null>();
  for (const row of availabilityRaw[0] ?? []) {
    if (row.val === null || !Number.isFinite(Number(row.val))) continue;
    const periodEnd = String(row.periodEnd).slice(0, 10);
    firstFiled.set(`${row.concept}|${periodEnd}`, row.sourceFiled ? String(row.sourceFiled).slice(0, 19) : null);
  }
  const rows = buildFactorPointRows(cik, f.detail, firstFiled);
  await db.transaction(async (tx) => {
    await tx.delete(factorPoints).where(eq(factorPoints.cik, cik));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(factorPoints).values(rows.slice(i, i + 500));
    }
  });
  return rows.length;
}

export interface FactorIcRow {
  factor: string;
  horizon: number;
  n: number;
  pearson: number | null;
  spearman: number | null;
}

/** Per-company, per-factor IC vs forward 1Q/2Q excess returns over SPY. */
export async function companyFactorIc(cik: number): Promise<FactorIcRow[]> {
  const db = getDb();
  const [pointsRaw]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
  const points = pointsRaw as { factor: string; filedAt: string; value: number }[];
  if (points.length === 0) return [];
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const spyBars = (await getBars(0, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: FactorIcRow[] = [];
  const factors: string[] = [...new Set<string>(points.map((p) => String(p.factor)))].sort();
  for (const factor of factors) {
    const pts = points.filter((p) => p.factor === factor);
    for (const h of HORIZONS) {
      const pairs: IcPair[] = [];
      for (const p of pts) {
        const anchor = String(p.filedAt).slice(0, 10);
        const y = excessForwardReturn(bars, spyBars, anchor, h);
        if (y !== null) pairs.push({ x: Number(p.value), y });
      }
      const st = icStats(pairs);
      out.push({ factor, horizon: h, ...st });
    }
  }
  return out;
}

/** Cross-sectional IC per quarter across the requested companies (all by default). */
export async function crossSectionFactorIc(requestedCiks?: number[]): Promise<(FactorIcRow & { quarter: string })[]> {
  const db = getDb();
  let ciks: number[];
  if (requestedCiks) {
    ciks = requestedCiks;
  } else {
    const [rows]: any = await db.execute(sql`SELECT DISTINCT cik FROM factor_points`);
    ciks = rows.map((r: any) => Number(r.cik));
  }
  const perQuarter = new Map<string, Map<string, IcPair>>();
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const spyBars = (await getBars(0, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const cik of ciks) {
    // rebuild per-quarter pairs from the same anchors (cheap second pass)
    const [ptsRaw]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
    const pts = ptsRaw as { factor: string; filedAt: string; value: number }[];
    const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
      .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const p of pts) {
      const anchor = String(p.filedAt).slice(0, 10);
      const quarter = anchor.slice(0, 7);
      for (const h of HORIZONS) {
        const y = excessForwardReturn(bars, spyBars, anchor, h);
        if (y === null) continue;
        const key = `${p.factor}|${quarter}|${h}`;
        if (!perQuarter.has(key)) perQuarter.set(key, new Map());
        perQuarter.get(key)!.set(`${cik}`, { x: Number(p.value), y });
      }
    }
  }
  const out: (FactorIcRow & { quarter: string })[] = [];
  for (const [key, m] of perQuarter) {
    const [factor, quarter, hStr] = key.split("|");
    const st = icStats([...m.values()]);
    out.push({ factor, quarter, horizon: Number(hStr), ...st });
  }
  return out.sort((a, b) => a.factor.localeCompare(b.factor) || a.quarter.localeCompare(b.quarter));
}
