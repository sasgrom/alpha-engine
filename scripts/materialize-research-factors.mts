/**
 * Materialize factor_points from already ingested facts for the research universe.
 * No SEC requests and no local-worker action required. Idempotent per CIK upsert.
 * Run: npx tsx scripts/materialize-research-factors.mts [--universe research-universe-53.json]
 */
import "dotenv/config";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { materializeFactorPoints } from "../api/services/factor-ic";

const idx = process.argv.indexOf("--universe");
const file = idx > -1 ? process.argv[idx + 1] : "research-universe-53.json";
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const universe = loadEdgarUniverse(file).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[factors] unknown ticker ${only}`); process.exit(1); }
let companies = 0, points = 0, failed = 0;
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (attempt < 3) {
        const wait = 250 * 2 ** attempt;
        console.log(`[factors] ${label}: transient failure, retry ${attempt + 1}/3 in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw last;
}
for (const [i, co] of universe.entries()) {
  try {
    const n = await withRetry(() => materializeFactorPoints(co.cik), co.ticker);
    companies++;
    points += n;
    console.log(`[factors ${i + 1}/${universe.length}] ${co.ticker}: ${n} factor points`);
  } catch (e: any) {
    failed++;
    console.error(`[factors ${i + 1}/${universe.length}] ${co.ticker}: FAILED ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
console.log(`[factors] done: ${companies} companies · ${points} factor points · ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
