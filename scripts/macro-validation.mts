/** Independent-universe and macro-regime validation for AssetGrowth. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { getBars } from "../api/services/prices";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { sectorNeutralDataset } from "../api/services/sector-neutral-ic";
import { applyVolTarget, quintileSpreads, strategyMetrics, type SpreadPoint } from "../api/services/sector-portfolio";
import { curveRegime, hyRegime, splitByCikParity, spyTrendRegime, valueAtOrBefore, vixRegime, type MacroPoint } from "../api/services/macro-regime";

const ciks = loadEdgarUniverse("research-universe-50.json").map((c) => c.cik);
const db = getDb();
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
function compact(m: ReturnType<typeof strategyMetrics>) {
  const { returns, ...rest } = m;
  return rest;
}
function meanCi(returns: number[], spreads: SpreadPoint[], iterations = 2000) {
  if (returns.length === 0) return { low: null, high: null };
  const quarters = [...new Set(spreads.map((s) => s.quarter))].sort();
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const sampled: string[] = [];
    for (let j = 0; j < quarters.length; j += 4) {
      const start = Math.floor(rnd() * quarters.length);
      for (let k = 0; k < 4; k++) sampled.push(quarters[(start + k) % quarters.length]);
    }
    const selected = sampled.flatMap((q) => spreads.map((s, i) => s.quarter === q ? returns[i] : null).filter((x): x is number => x !== null));
    means.push(mean(selected));
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor(iterations * 0.025)], high: means[Math.floor(iterations * 0.975)] };
}
function evaluate(base: SpreadPoint[], target: SpreadPoint[]) {
  const baseline = strategyMetrics(base), volTarget = strategyMetrics(target);
  return { baseline: { ...compact(baseline), ci95: meanCi(baseline.returns, base) }, volTarget: { ...compact(volTarget), ci95: meanCi(volTarget.returns, target) } };
}
const allRows = await sectorNeutralDataset(ciks);
const base = quintileSpreads(allRows.filter((r) => r.factor === "assetGrowth"), 1);
const target = applyVolTarget(base);
const independent: any[] = [];
for (const [label, subset] of Object.entries(splitByCikParity(ciks))) {
  const rows = allRows.filter((r) => subset.includes(r.cik));
  const b = quintileSpreads(rows, 1), t = applyVolTarget(b);
  independent.push({ universe: label, companies: subset.length, all: evaluate(b, t), finalHoldout: evaluate(b.slice(Math.floor(b.length * 0.8)), t.slice(Math.floor(b.length * 0.8))) });
}
const [companyRows]: any = await db.execute(sql`SELECT cik, sector FROM companies`);
const sectorByCik = new Map<number, string>(companyRows.map((r: any) => [Number(r.cik), String(r.sector ?? "Unknown")]));
const sectors = [...new Set(sectorByCik.values())].sort();
for (const sector of sectors) {
  const subset = ciks.filter((cik) => sectorByCik.get(cik) === sector);
  if (subset.length < 5) { independent.push({ sector, companies: subset.length, status: "insufficient for quintiles" }); continue; }
  const rows = allRows.filter((r) => subset.includes(r.cik));
  const b = quintileSpreads(rows, 1), t = applyVolTarget(b);
  independent.push({ sector, companies: subset.length, all: evaluate(b, t), finalHoldout: evaluate(b.slice(Math.floor(b.length * 0.8)), t.slice(Math.floor(b.length * 0.8))) });
}

const [macroRows]: any = await db.execute(sql`SELECT seriesId, date, value FROM macro_points WHERE seriesId IN ('VIXCLS','T10Y2Y','BAMLH0A0HYM2') ORDER BY date`);
const macro = new Map<string, MacroPoint[]>();
for (const r of macroRows) {
  const key = String(r.seriesId);
  if (!macro.has(key)) macro.set(key, []);
  macro.get(key)!.push({ date: String(r.date).slice(0, 10), value: r.value === null ? null : Number(r.value) });
}
const spyBars = (await getBars(0, "2009-01-01")).filter((b) => (b.adjClose ?? b.close) !== null)
  .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number })).sort((a, b) => a.date.localeCompare(b.date));
function regime(kind: string, s: SpreadPoint): string {
  const date = `${s.quarter}-01`;
  if (kind === "vix") return vixRegime(valueAtOrBefore(macro.get("VIXCLS") ?? [], date));
  if (kind === "curve") return curveRegime(valueAtOrBefore(macro.get("T10Y2Y") ?? [], date));
  if (kind === "hy") return hyRegime(valueAtOrBefore(macro.get("BAMLH0A0HYM2") ?? [], date));
  return spyTrendRegime(spyBars, date);
}
const macroReport: any[] = [];
for (const kind of ["vix", "curve", "hy", "spyTrend"]) {
  const labels = [...new Set(base.map((s) => regime(kind, s)))].filter((x) => x !== "unknown").sort();
  for (const label of labels) {
    const b = base.filter((s) => regime(kind, s) === label), t = target.filter((s) => regime(kind, s) === label);
    macroReport.push({ kind, regime: label, n: b.length, ...evaluate(b, t) });
  }
}
console.log(JSON.stringify({ independent, macro: macroReport }, null, 2));
process.exit(0);
