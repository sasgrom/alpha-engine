/** Evaluate EDGAR v1 tone against forward excess returns over SPY. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { getBars } from "../api/services/prices";
import { excessForwardReturn, icStats, type IcPair } from "../api/services/ic";
import { loadEdgarUniverse } from "../worker/lib/edgar";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const ciks = loadEdgarUniverse("research-universe-50.json").filter((c) => !only || c.ticker === only).map((c) => c.cik);
if (only && ciks.length === 0) { console.error(`[tone-ic] unknown ticker ${only}`); process.exit(1); }
const db = getDb();
const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
const spyBars = (await getBars(0, from)).filter((b) => (b.adjClose ?? b.close) !== null)
  .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number })).sort((a, b) => a.date.localeCompare(b.date));
const [signals]: any = await db.execute(sql`SELECT cik, eventTs, score FROM signals WHERE source='edgar' AND signalType='tone' AND score IS NOT NULL ORDER BY eventTs`);
const wanted = new Set(ciks);
const pairs: (IcPair & { cik: number; quarter: string; horizon: number })[] = [];
for (const cik of ciks) {
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number })).sort((a, b) => a.date.localeCompare(b.date));
  const [rows]: any = await db.execute(sql`SELECT eventTs, score FROM signals WHERE cik=${cik} AND source='edgar' AND signalType='tone' AND score IS NOT NULL ORDER BY eventTs`);
  const byQuarter = new Map<string, { x: number[]; y: number[] }>();
  for (const r of rows) {
    const anchor = String(r.eventTs).slice(0, 10), quarter = anchor.slice(0, 7), score = Number(r.score);
    if (!Number.isFinite(score)) continue;
    for (const h of [63, 126]) {
      const y = excessForwardReturn(bars, spyBars, anchor, h);
      if (y === null) continue;
      const key = `${quarter}|${h}`;
      if (!byQuarter.has(key)) byQuarter.set(key, { x: [], y: [] });
      byQuarter.get(key)!.x.push(score);
      byQuarter.get(key)!.y.push(y);
    }
  }
  for (const [key, pts] of byQuarter) {
    const [quarter, hStr] = key.split("|");
    const x = pts.x.reduce((s, v) => s + v, 0) / pts.x.length;
    const y = pts.y.reduce((s, v) => s + v, 0) / pts.y.length;
    pairs.push({ cik: cik, quarter, horizon: Number(hStr), x, y });
  }
}
const summarize = (rs: typeof pairs) => {
  const byQuarter = new Map<string, IcPair[]>();
  for (const r of rs) {
    if (!byQuarter.has(r.quarter)) byQuarter.set(r.quarter, []);
    byQuarter.get(r.quarter)!.push({ x: r.x, y: r.y });
  }
  const stats = [...byQuarter.entries()].map(([quarter, p]) => ({ quarter, ...icStats(p) }));
  const n = stats.reduce((s, r) => s + r.n, 0);
  const valid = stats.filter((r) => r.spearman !== null);
  return {
    quarters: valid.length,
    n,
    weightedSpearman: n ? valid.reduce((s, r) => s + r.spearman * r.n, 0) / n : null,
    medianSpearman: valid.length ? valid.map((r) => r.spearman).sort((a, b) => a - b)[Math.floor(valid.length / 2)] : null,
    positiveShare: valid.length ? valid.filter((r) => r.spearman > 0).length / valid.length : null,
  };
};
function ci95(rs: typeof pairs, iterations = 2000) {
  const quarters = [...new Set(rs.map((r) => r.quarter))].sort();
  if (!quarters.length) return { low: null, high: null };
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const sampled: string[] = [];
    for (let j = 0; j < quarters.length; j += 4) {
      const start = Math.floor(rnd() * quarters.length);
      for (let k = 0; k < 4; k++) sampled.push(quarters[(start + k) % quarters.length]);
    }
    const block = sampled.flatMap((q) => rs.filter((r) => r.quarter === q));
    means.push(summarize(block).weightedSpearman);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor(iterations * 0.025)], high: means[Math.floor(iterations * 0.975)] };
}
const out: any = {};
for (const h of [63, 126]) {
  const rs = pairs.filter((r) => r.horizon === h);
  out[h] = { ...summarize(rs), ci95: ci95(rs) };
}
const years = [...new Set(pairs.map((r) => r.quarter.slice(0, 4)))].sort();
out.yearly = {};
for (const y of years) {
  out.yearly[y] = {};
  for (const h of [63, 126]) {
    out.yearly[y][h] = summarize(pairs.filter((r) => r.horizon === h && r.quarter.startsWith(y)));
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
