/**
 * 6a — materialize factor_points from computeCompanyFactors histories, then
 * evaluate per-factor IC against forward returns. Availability anchor:
 * max(sourceFiled of the period's concepts; fallback = periodEnd + 45d, the
 * EDGAR lag, flagged in the payload as estimated).
 */
import { eq, sql } from "drizzle-orm";
import { factorPoints } from "@db/schema";
import { getDb } from "../queries/connection";
import { computeCompanyFactors } from "./factors";
import { getBars } from "./prices";
import { forwardReturn, icStats, type IcPair } from "./ic";

const HORIZONS = [63, 126] as const; // ~1Q, ~2Q in trading days

export interface FactorPointWriteRow {
  cik: number;
  factor: string;
  periodEnd: string;
  filedAt: string;
  value: number | null;
}

/** Pure availability mapping, shared by tests and the batched writer. */
export function buildFactorPointRows(
  cik: number,
  detail: Record<string, { history: { t: string; v: number | null }[] }>,
  firstFiledByPeriod: ReadonlyMap<string, string>,
): FactorPointWriteRow[] {
  const out: FactorPointWriteRow[] = [];
  for (const [factor, det] of Object.entries(detail)) {
    const isMarketFactor = factor === "momentum122" || factor === "high52";
    for (const pt of det.history) {
      const firstFiled = firstFiledByPeriod.get(pt.t);
      const filedAt = isMarketFactor
        ? `${pt.t} 00:00:00`
        : firstFiled
          ? firstFiled.slice(0, 19)
          : `${new Date(Date.parse(pt.t + "T00:00:00Z") + 45 * 86400_000).toISOString().slice(0, 19).replace("T", " ")}`;
      out.push({ cik, factor, periodEnd: pt.t, filedAt, value: pt.v });
    }
  }
  return out;
}

/** Recompute one company's factor points with one grouped facts query and an
 * atomic per-CIK replacement, so stale histories cannot survive a rebuild. */
export async function materializeFactorPoints(cik: number): Promise<number> {
  const db = getDb();
  const [f, factDatesRaw]: [any, any] = await Promise.all([
    computeCompanyFactors(cik),
    db.execute(sql`SELECT endDate, MIN(filed) m FROM facts WHERE cik=${cik} GROUP BY endDate`),
  ]);
  const firstFiled = new Map<string, string>((factDatesRaw[0] ?? []).map((r: any) => [String(r.endDate).slice(0, 10), String(r.m).slice(0, 19)]));
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

/** Per-company, per-factor IC vs forward 1Q/2Q returns (availability-anchored). */
export async function companyFactorIc(cik: number): Promise<FactorIcRow[]> {
  const db = getDb();
  const [pointsRaw]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
  const points = pointsRaw as { factor: string; filedAt: string; value: number }[];
  if (points.length === 0) return [];
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
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
        const y = forwardReturn(bars, anchor, h);
        if (y !== null) pairs.push({ x: Number(p.value), y });
      }
      const st = icStats(pairs);
      out.push({ factor, horizon: h, ...st });
    }
  }
  return out;
}

/** Cross-sectional IC per quarter across all materialized companies. */
export async function crossSectionFactorIc(): Promise<(FactorIcRow & { quarter: string })[]> {
  const db = getDb();
  const [ciksRaw]: any = await db.execute(sql`SELECT DISTINCT cik FROM factor_points`);
  const ciks = ciksRaw as { cik: number }[];
  const perQuarter = new Map<string, Map<string, IcPair>>();
  for (const { cik } of ciks) {
    // rebuild per-quarter pairs from the same anchors (cheap second pass)
    const [ptsRaw]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
    const pts = ptsRaw as { factor: string; filedAt: string; value: number }[];
    const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
    const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
      .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const p of pts) {
      const anchor = String(p.filedAt).slice(0, 10);
      const quarter = anchor.slice(0, 7);
      for (const h of HORIZONS) {
        const y = forwardReturn(bars, anchor, h);
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
