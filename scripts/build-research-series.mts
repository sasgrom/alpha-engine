/**
 * Build canonical series_points from already ingested facts for research CIKs.
 * No SEC requests. Per-CIK replacement is atomic. Run after facts snapshots.
 * Run: npx tsx scripts/build-research-series.mts [--universe research-universe-53.json]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { buildCompanySeries } from "../api/services/series";

const idx = process.argv.indexOf("--universe");
const file = idx > -1 ? process.argv[idx + 1] : "research-universe-53.json";
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
let universe = loadEdgarUniverse(file).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[series] unknown ticker ${only}`); process.exit(1); }
if (process.argv.includes("--skip-built")) {
  const [rows]: any = await getDb().execute(sql`SELECT DISTINCT cik FROM series_points`);
  const built = new Set(rows.map((r: any) => Number(r.cik)));
  universe = universe.filter((c) => !built.has(c.cik));
  console.log(`[series] resume: ${universe.length} companies without series_points`);
}
let companies = 0, series = 0, points = 0, failed = 0;
for (const [i, co] of universe.entries()) {
  try {
    const r = await buildCompanySeries(co.cik);
    companies++;
    series += r.series;
    points += r.points;
    console.log(`[series ${i + 1}/${universe.length}] ${co.ticker}: ${r.series} series · ${r.points} points · coverage ${(r.avgCoverage * 100).toFixed(0)}%`);
  } catch (e: any) {
    failed++;
    console.error(`[series ${i + 1}/${universe.length}] ${co.ticker}: FAILED ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
console.log(`[series] done: ${companies} companies · ${series} series · ${points} points · ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
