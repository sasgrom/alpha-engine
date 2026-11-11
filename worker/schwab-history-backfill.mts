/**
 * One-off Schwab daily history for every ticker the daily price jobs cover (the research universe, the S&P 500
 * snapshot, SPY and the eleven sector funds), so the local Schwab price series start without holes and overlap the
 * Stooq history. Raw responses stay on D:, one file per ticker; an existing file with candles is a completed
 * checkpoint, so a rerun resumes. Load the files with: npx tsx worker/schwab-daily-bars.mts --history-dir <dir>
 *
 * Usage: npx tsx worker/schwab-history-backfill.mts [--years 1] [--out <dir>] [--only TICKER]
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSchwabSession } from "./lib/schwab-paced";
import { schwabPriceSeries } from "./lib/schwab-price-series";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const years = Number(arg("--years") ?? 1);
if (![1, 2, 3, 5, 10, 15, 20].includes(years)) throw new Error("--years must be one of 1, 2, 3, 5, 10, 15, 20 (Schwab periods)");
const today = new Date().toISOString().slice(0, 10);
const out = path.resolve(arg("--out") ?? `D:/research/alpha-engine/schwab-sp500/pricehistory-backfill/${today}-${years}y`);
if (process.platform === "win32" && !/^d:/i.test(out)) throw new Error("Raw Schwab archives must stay on the D: drive");
const only = arg("--only")?.toUpperCase() ?? null;
const series = schwabPriceSeries().filter((entry) => !only || entry.ticker === only);
if (only && !series.length) throw new Error(`Unknown ticker ${only}`);
mkdirSync(out, { recursive: true });
const prog = startProgress("schwab-history-backfill", `${series.length} tickers · ${years} year(s) · ${out}`);
const session = createSchwabSession({ log: (line) => prog.log(line) });
await session.prepare();

const complete = (file: string) => {
  try { return JSON.parse(readFileSync(file, "utf8")).candles?.length > 0; } catch { return false; }
};
const results: { ticker: string; status: "complete" | "resumed" | "failed"; candles?: number; error?: string }[] = [];
let transportFailures = 0;
for (const [index, entry] of series.entries()) {
  const file = path.join(out, `${entry.ticker}.json`);
  if (complete(file)) {
    results.push({ ticker: entry.ticker, status: "resumed" });
    continue;
  }
  try {
    const body = await session.get(`pricehistory?symbol=${encodeURIComponent(entry.schwabSymbol)}&periodType=year&period=${years}&frequencyType=daily&frequency=1`);
    const candles = JSON.parse(body).candles;
    if (!Array.isArray(candles) || !candles.length) throw new Error(`No candles for ${entry.schwabSymbol}`);
    const tmp = `${file}.${process.pid}.tmp`;
    try { writeFileSync(tmp, body); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
    results.push({ ticker: entry.ticker, status: "complete", candles: candles.length });
    transportFailures = 0;
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    results.push({ ticker: entry.ticker, status: "failed", error: String(error).slice(0, 240) });
    transportFailures = status === undefined ? transportFailures + 1 : 0;
  }
  prog.item(index + 1, series.length, `${entry.ticker} ${results.at(-1)!.status}`);
  if (transportFailures >= 2) break;
}
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  out,
  years,
  tickers: series.length,
  complete: results.filter((row) => row.status !== "failed").length,
  failed: results.filter((row) => row.status === "failed"),
  stoppedEarly: transportFailures >= 2,
};
writeJsonAtomic(path.join(out, "_summary.json"), summary, true);
prog.done(`${summary.complete}/${summary.tickers} complete · ${summary.failed.length} failed${summary.stoppedEarly ? " · stopped after two transport failures (rerun resumes)" : ""}`);
if (summary.stoppedEarly || summary.complete < series.length) process.exitCode = 1;
