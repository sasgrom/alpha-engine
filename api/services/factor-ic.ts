/**
 * 6a — materialize factor_points from computeCompanyFactors histories, then
 * evaluate per-factor IC against forward returns. Availability anchor:
 * max(sourceFiled of the period's concepts; fallback = periodEnd + 45d, the
 * EDGAR lag, flagged in the payload as estimated).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { computeCompanyFactors } from "./factors";
import { getBars } from "./prices";
import { forwardReturn, icStats, type IcPair } from "./ic";

const HORIZONS = [63, 126] as const; // ~1Q, ~2Q in trading days

/** Recompute one company's factor points (idempotent upsert). */
export async function materializeFactorPoints(cik: number): Promise<number> {
  const db = getDb();
  const f = await computeCompanyFactors(cik);
  let n = 0;
  for (const [factor, det] of Object.entries(f.detail)) {
    for (const pt of det.history) {
      // availability = latest filed of any concept for that period (honest fallback +45d)
      const [fr]: any = await db.execute(sql`SELECT MAX(filed) m FROM facts WHERE cik=${cik} AND endDate=${pt.t}`);
      const filed = fr[0]?.m ? String(fr[0].m).slice(0, 19) : `${pt.t} 00:00:00`;
      const filedAt = fr[0]?.m ? filed : `${new Date(Date.parse(pt.t + "T00:00:00Z") + 45 * 86400_000).toISOString().slice(0, 19).replace("T", " ")}`;
      await db.execute(sql`INSERT INTO factor_points (cik, factor, periodEnd, filedAt, value)
        VALUES (${cik}, ${factor}, ${pt.t}, ${filedAt}, ${pt.v})
        ON DUPLICATE KEY UPDATE value=VALUES(value), filedAt=VALUES(filedAt), computedAt=NOW()`);
      n++;
    }
  }
  return n;
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
  const [points]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
  if (points.length === 0) return [];
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: FactorIcRow[] = [];
  const factors = [...new Set(points.map((p: any) => String(p.factor)))].sort();
  for (const factor of factors) {
    const pts = points.filter((p: any) => p.factor === factor);
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
  const [ciks]: any = await db.execute(sql`SELECT DISTINCT cik FROM factor_points`);
  const perQuarter = new Map<string, Map<string, { x: number; y: number }[]>>();
  for (const { cik } of ciks as { cik: number }[]) {
    // rebuild per-quarter pairs from the same anchors (cheap second pass)
    const [pts]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
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
