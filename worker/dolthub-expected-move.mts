/** Expected-move calibration: implied IV versus trailing RV20, matched by actual DTE. */
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { trailingRealizedVolatility } from "../api/services/forward-volatility";
import { loadEdgarUniverse } from "./lib/edgar";
import { absoluteForwardMove, expectedMove, summarizeExpectedMoves, type ExpectedMoveRow } from "./lib/expected-move";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const inputRoot = path.resolve(arg("--input") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-features" : "worker/cache/options-dolthub/features"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-research" : "worker/cache/options-dolthub/research"));
const currentYear = new Date().getUTCFullYear();
const explicitYears = arg("--years")?.split(",").map(Number).filter(Number.isInteger);
const fromYear = Number(arg("--from-year") ?? 2019), toYear = Number(arg("--to-year") ?? currentYear);
const years = explicitYears?.length ? explicitYears : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
const prog = startProgress("expected-move", `input ${inputRoot}`);
const manifest = JSON.parse(readFileSync(path.join(inputRoot, "manifest.json"), "utf8")) as { batches: { ticker: string; year: number; status: string }[] };
const universe = loadEdgarUniverse("dolthub-universe-40.json").filter((c) => !only || c.ticker === only);
if (only && !universe.length) throw new Error(`Unknown or non-core ticker ${only}`);
const cikByTicker = new Map(universe.map((c) => [c.ticker, c.cik]));
const batches = manifest.batches.filter((b) => b.status === "done" && cikByTicker.has(b.ticker) && years.includes(b.year));
const db = getDb();
async function bars(cik: number) {
  const [rows]: any = await db.execute(sql`SELECT date, close, adjClose FROM prices WHERE cik=${cik} ORDER BY date`);
  return rows.map((r: any) => ({ date: String(r.date).slice(0, 10), close: Number(r.adjClose ?? r.close) })).filter((r: any) => Number.isFinite(r.close) && r.close > 0);
}
const atmRows: ExpectedMoveRow[] = [], rvRows: ExpectedMoveRow[] = [];
let snapshots = 0, usable = 0;
for (const batch of batches) {
  const stockBars = await bars(cikByTicker.get(batch.ticker)!);
  const input = createInterface({ input: createReadStream(path.join(inputRoot, batch.ticker, `${batch.year}.jsonl`), "utf8"), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    snapshots++;
    const feature = JSON.parse(line);
    const bucket = ["31-90D", "8-30D"].map((name) => feature.buckets.find((b: any) => b.bucket === name)).find(Boolean);
    if (!bucket || bucket.dteMedian === null || bucket.atmIv === null || !(feature.spot > 0) || !bucket.dteMedian) continue;
    const dte = Math.max(1, Math.round(bucket.dteMedian));
    const actual = absoluteForwardMove(stockBars, feature.tradeDate, dte);
    if (!actual) continue;
    const trailingRv = trailingRealizedVolatility(stockBars, feature.tradeDate, 20);
    if (trailingRv === null) continue;
    const atmExpected = expectedMove(feature.spot, bucket.atmIv, dte), rvExpected = expectedMove(feature.spot, trailingRv, dte);
    if (atmExpected === null || rvExpected === null) continue;
    atmRows.push({ date: feature.tradeDate, expected: atmExpected, actual: actual.move });
    rvRows.push({ date: feature.tradeDate, expected: rvExpected, actual: actual.move });
    usable++;
  }
  prog.log(`${batch.ticker} ${batch.year}: complete`);
}
function byYear(rows: ExpectedMoveRow[]) {
  return Object.fromEntries(
    [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort().map((year) => [
      year,
      summarizeExpectedMoves(rows.filter((r) => r.date.startsWith(year))),
    ])
  );
}
if (usable === 0) {
  throw new Error("No usable snapshots: dteMedian is missing in every feature set. Rerun worker/dolthub-features.mts with schemaVersion 2, then rerun expected move.");
}
const output = {
  generatedAt: new Date().toISOString(), snapshots, usable,
  scope: "Expected move = spot · IV · sqrt(actual DTE/365). No normal-68% assumption.",
  atmIv: { overall: summarizeExpectedMoves(atmRows), byYear: byYear(atmRows) },
  rv20: { overall: summarizeExpectedMoves(rvRows), byYear: byYear(rvRows) },
  comparison: {
    coverageDelta: (summarizeExpectedMoves(atmRows).coverage ?? 0) - (summarizeExpectedMoves(rvRows).coverage ?? 0),
    maeDelta: (summarizeExpectedMoves(atmRows).mae ?? 0) - (summarizeExpectedMoves(rvRows).mae ?? 0),
    rmseDelta: (summarizeExpectedMoves(atmRows).rmse ?? 0) - (summarizeExpectedMoves(rvRows).rmse ?? 0),
  },
};
writeJsonAtomic(path.join(outRoot, "expected-move.json"), output, true);
prog.done(`snapshots ${snapshots} · usable ${usable}`);
process.exit(0);
