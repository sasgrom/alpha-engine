/** Preregistered DoltHub IC and robustness evaluation on feature JSONL. */
import "dotenv/config";
import { createReadStream, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { excessForwardReturnInfo, type ForwardReturnInfo } from "../api/services/ic";
import { forwardRealizedVolatility, trailingRealizedVolatility } from "../api/services/forward-volatility";
import { benjaminiHochberg } from "../api/services/research-metrics";
import { loadEdgarUniverse } from "./lib/edgar";
import { FACTOR_CONFIGS, evaluateFactorRows, type ResearchRow } from "./lib/dolthub-research";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { OptionFeatureSet } from "./lib/option-features";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const inputRoot = path.resolve(arg("--input") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-features" : "worker/cache/options-dolthub/features"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-research" : "worker/cache/options-dolthub/research"));
const currentYear = new Date().getUTCFullYear();
const explicitYears = arg("--years")?.split(",").map(Number).filter(Number.isInteger);
const fromYear = Number(arg("--from-year") ?? 2019), toYear = Number(arg("--to-year") ?? currentYear);
const years = explicitYears?.length ? explicitYears : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
const prog = startProgress("dolt-research", `input ${inputRoot} · years ${years.join(",")}`);
const manifest = JSON.parse(readFileSync(path.join(inputRoot, "manifest.json"), "utf8")) as { batches: { ticker: string; year: number; status: string }[] };
const universe = loadEdgarUniverse("dolthub-universe-40.json").filter((c) => !only || c.ticker === only);
if (only && !universe.length) throw new Error(`Unknown or non-core ticker ${only}`);
const cikByTicker = new Map(universe.map((c) => [c.ticker, c.cik]));
const batches = manifest.batches.filter((b) => b.status === "done" && cikByTicker.has(b.ticker) && years.includes(b.year));
const db = getDb();
const [companyRows]: any = await db.execute(sql`SELECT cik, sector FROM companies`);
const sectorByCik = new Map<number, string>(companyRows.map((r: any) => [Number(r.cik), String(r.sector ?? "Unknown")]));
async function bars(cik: number) {
  const [rows]: any = await db.execute(sql`SELECT date, close, adjClose FROM prices WHERE cik=${cik} ORDER BY date`);
  return rows.map((r: any) => ({ date: String(r.date).slice(0, 10), close: Number(r.adjClose ?? r.close) })).filter((r: any) => Number.isFinite(r.close) && r.close > 0);
}
const spyBars = await bars(0);
const factorRows = new Map<string, ResearchRow[]>(Object.keys(FACTOR_CONFIGS).map((f) => [f, []]));
let snapshots = 0, usableSnapshots = 0;
for (const batch of batches) {
  const cik = cikByTicker.get(batch.ticker)!;
  const stockBars = await bars(cik);
  const file = path.join(inputRoot, batch.ticker, `${batch.year}.jsonl`);
  const input = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    snapshots++;
    const feature = JSON.parse(line) as OptionFeatureSet;
    const anchor = feature.tradeDate;
    const rv21 = forwardRealizedVolatility(stockBars, anchor, 21);
    const rv63 = forwardRealizedVolatility(stockBars, anchor, 63);
    const excess63 = excessForwardReturnInfo(stockBars, spyBars, anchor, 63) as ForwardReturnInfo | null;
    const trailingRv = trailingRealizedVolatility(stockBars, anchor, 20);
    let used = false;
    for (const [factor, config] of Object.entries(FACTOR_CONFIGS)) {
      const bucket = config.bucketPreference.map((name) => feature.buckets.find((b) => b.bucket === name)).find(Boolean);
      if (!bucket) continue;
      let x = config.select(bucket);
      if (factor === "vrp") {
        if (trailingRv === null || x === null) continue;
        x = x! - trailingRv;
      }
      const y = factor === "termSlope" ? rv21?.vol : factor === "skew25" ? excess63?.ret : rv63?.vol;
      if (x === null || y === null || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      factorRows.get(factor)!.push({
        cik, ticker: batch.ticker, sector: sectorByCik.get(cik) ?? "Unknown",
        date: anchor, quarter: anchor.slice(0, 7), bucket: bucket.bucket,
        factor, horizon: factor === "termSlope" ? 21 : 63, x, y,
      });
      used = true;
    }
    if (used) usableSnapshots++;
  }
  prog.log(`${batch.ticker} ${batch.year}: complete`);
}
mkdirSync(outRoot, { recursive: true });
const results: Record<string, unknown> = {};
const pValues: number[] = [], factorNames: string[] = [];
for (const [factor, rows] of factorRows) {
  const evaluated = evaluateFactorRows(rows);
  results[factor] = evaluated;
  const p = (evaluated.overall as any).pNormalApprox;
  if (p !== null) { pValues.push(p); factorNames.push(factor); }
}
const fdr = benjaminiHochberg(pValues, 0.05);
factorNames.forEach((name, i) => {
  (results[name] as any).overall.fdrAdjustedP = fdr[i].pAdjusted;
  (results[name] as any).overall.fdrRejected = fdr[i].rejected;
});
const output = {
  generatedAt: new Date().toISOString(), protocol: "alpha-option-hypotheses-v1",
  scope: "Preregistered primary metrics with moving-block bootstrap CI; normal p-values are secondary",
  snapshots, usableSnapshots, years, factors: results,
};
writeJsonAtomic(path.join(outRoot, "dolthub-research.json"), output, true);
prog.done(`snapshots ${snapshots} · usable ${usableSnapshots} · factors ${factorNames.length}`);
process.exit(0);
