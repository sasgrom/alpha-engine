/** Economic evaluation of sector-neutral asset-growth quintiles. */
import "dotenv/config";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { sectorNeutralDataset } from "../api/services/sector-neutral-ic";
import { quintileSpreads, strategyMetrics } from "../api/services/sector-portfolio";

const ciks = loadEdgarUniverse("research-universe-50.json").map((c) => c.cik);
const rows = await sectorNeutralDataset(ciks);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
function meanCi(returns: number[], spreads: any[], iterations = 2000) {
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
const out: any[] = [];
for (const horizon of [63, 126]) {
  for (const direction of [1, -1] as const) {
    const subset = rows.filter((r) => r.factor === "assetGrowth" && r.horizon === horizon);
    const spreads = quintileSpreads(subset, direction);
    const metrics = strategyMetrics(spreads);
    out.push({ horizon, direction: direction === 1 ? "high asset growth minus low" : "low asset growth minus high", ...metrics, ci95: meanCi(metrics.returns, spreads) });
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
