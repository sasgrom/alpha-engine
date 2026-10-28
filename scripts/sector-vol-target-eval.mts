/** Pre-registered volatility-target evaluation with chronological holdout. */
import "dotenv/config";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { sectorNeutralDataset } from "../api/services/sector-neutral-ic";
import { applyVolTarget, quintileSpreads, strategyMetrics, type SpreadPoint } from "../api/services/sector-portfolio";

const ciks = loadEdgarUniverse("research-universe-50.json").map((c) => c.cik);
const rows = await sectorNeutralDataset(ciks);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
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
function compact(m: ReturnType<typeof strategyMetrics>) {
  const { returns, ...rest } = m;
  return rest;
}
const out: any[] = [];
for (const horizon of [63, 126]) {
  const base = quintileSpreads(rows.filter((r) => r.factor === "assetGrowth" && r.horizon === horizon), 1);
  const targeted = applyVolTarget(base);
  const segments = [
    ["development", base.slice(0, Math.floor(base.length * 0.6)), targeted.slice(0, Math.floor(base.length * 0.6))],
    ["validation", base.slice(Math.floor(base.length * 0.6), Math.floor(base.length * 0.8)), targeted.slice(Math.floor(base.length * 0.6), Math.floor(base.length * 0.8))],
    ["final-holdout", base.slice(Math.floor(base.length * 0.8)), targeted.slice(Math.floor(base.length * 0.8))],
  ] as const;
  for (const [name, baseSeg, targetSeg] of segments) {
    const baseline = strategyMetrics(baseSeg), volTarget = strategyMetrics(targetSeg);
    out.push({ horizon, segment: name,
      baseline: { ...compact(baseline), ci95: meanCi(baseline.returns, baseSeg) },
      volTarget: { ...compact(volTarget), ci95: meanCi(volTarget.returns, targetSeg) },
    });
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
