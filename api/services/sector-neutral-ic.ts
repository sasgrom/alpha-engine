/**
 * Sector-neutral factor IC: residual factor values AND residual forward returns.
 * A sector needs >=4 names, otherwise the median falls back to the full panel.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { getBars } from "./prices";
import { forwardReturn, icStats, type IcPair } from "./ic";
import type { FactorIcRow } from "./factor-ic";

export interface SectorReturnPoint extends IcPair {
  cik: number;
  sector: string;
  factor: string;
  quarter: string;
  horizon: number;
}
export interface NeutralizedPoint extends SectorReturnPoint {
  xMethod: "sector" | "global";
  yMethod: "sector" | "global";
}
export function medianOf(xs: number[]): number {
  if (xs.length === 0) throw new Error("medianOf(empty)");
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function groupBy<T>(rows: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(row);
  }
  return out;
}

export function neutralizeBySector(points: SectorReturnPoint[], minSectorSize = 4): NeutralizedPoint[] {
  const xSector = groupBy(points, (p) => `${p.sector}|${p.factor}|${p.quarter}|${p.horizon}`);
  const ySector = groupBy(points, (p) => `${p.sector}|${p.quarter}|${p.horizon}`);
  const xGlobal = groupBy(points, (p) => `${p.factor}|${p.quarter}|${p.horizon}`);
  const yGlobal = groupBy(points, (p) => `${p.quarter}|${p.horizon}`);
  const medianMap = (m: Map<string, SectorReturnPoint[]>) => new Map([...m.entries()].map(([k, rows]) => [k, medianOf(rows.map((r) => r.x))]));
  const medianYMap = (m: Map<string, SectorReturnPoint[]>) => new Map([...m.entries()].map(([k, rows]) => [k, medianOf(rows.map((r) => r.y))]));
  const sx = medianMap(xSector), sy = medianYMap(ySector), gx = medianMap(xGlobal), gy = medianYMap(yGlobal);
  return points.map((p) => {
    const xk = `${p.sector}|${p.factor}|${p.quarter}|${p.horizon}`;
    const yk = `${p.sector}|${p.quarter}|${p.horizon}`;
    const xUseSector = (xSector.get(xk)?.length ?? 0) >= minSectorSize;
    const yUseSector = (ySector.get(yk)?.length ?? 0) >= minSectorSize;
    return {
      ...p,
      x: p.x - (xUseSector ? sx.get(xk)! : gx.get(`${p.factor}|${p.quarter}|${p.horizon}`)!),
      y: p.y - (yUseSector ? sy.get(yk)! : gy.get(`${p.quarter}|${p.horizon}`)!),
      xMethod: xUseSector ? "sector" : "global",
      yMethod: yUseSector ? "sector" : "global",
    };
  });
}

export async function sectorNeutralDataset(ciks: number[]): Promise<NeutralizedPoint[]> {
  const db = getDb();
  const [companyRows]: any = await db.execute(sql`SELECT cik, sector FROM companies`);
  const sectorByCik = new Map<number, string>(companyRows.map((r: any) => [Number(r.cik), String(r.sector ?? "Unknown")]));
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const raw: SectorReturnPoint[] = [];
  for (const cik of ciks) {
    const [pts]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
    const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
      .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const p of pts) {
      const anchor = String(p.filedAt).slice(0, 10), quarter = anchor.slice(0, 7);
      for (const h of [63, 126]) {
        const y = forwardReturn(bars, anchor, h);
        if (y === null) continue;
        raw.push({ cik, sector: sectorByCik.get(cik) ?? "Unknown", factor: String(p.factor), quarter, horizon: h, x: Number(p.value), y });
      }
    }
  }
  return neutralizeBySector(raw);
}

export async function sectorNeutralFactorIc(ciks: number[]): Promise<(FactorIcRow & { quarter: string })[]> {
  const neutral = await sectorNeutralDataset(ciks);
  const grouped = groupBy(neutral, (p) => `${p.factor}|${p.quarter}|${p.horizon}`);
  return [...grouped.entries()].map(([key, rows]) => {
    const [factor, quarter, hStr] = key.split("|");
    const stats = icStats(rows.map((r) => ({ x: r.x, y: r.y })));
    return { factor, quarter, horizon: Number(hStr), ...stats };
  }).sort((a, b) => a.factor.localeCompare(b.factor) || a.quarter.localeCompare(b.quarter));
}
