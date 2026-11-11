/**
 * DoltHub option history for many tickers, one snapshot date at a time. The option_chain primary key starts with
 * the date, so one date for all tickers takes about a second, while one ticker over a year makes Dolt read the
 * whole year (dolthub-export.mts, about a minute per ticker and year). Output is the same as dolthub-export.mts:
 * one CSV per ticker and year under the export root, the same columns and row order, the same manifest.
 *
 * A year is the unit of work: its files are written as .tmp and renamed only after every snapshot date of the year
 * is in, so an interrupted year is simply redone. Batches already in the manifest are never rewritten: their files
 * are rebuilt alongside and compared byte for byte as a check of this export, then the rebuilt copy is removed.
 * Tickers are the daily price series (S&P 500 snapshot, research universe, SPY, sector funds) that DoltHub lists.
 *
 * Usage: npx tsx worker/dolthub-export-dates.mts [--years 2019,2020] [--only TICKER,TICKER] [--dolt-root <dir>] [--out <dir>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dateSql, DOLT_CSV_HEADER, isAllowedOutputRoot, mergeBatches, sha256File, splitBySymbol } from "./lib/dolthub-export";
import { schwabPriceSeries } from "./lib/schwab-price-series";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

type BatchStatus = "done" | "empty" | "error";
interface Batch { ticker: string; year: number; file: string; status: BatchStatus; rows: number; firstDate: string | null; lastDate: string | null; sha256: string | null; error?: string }
interface Manifest { source: string; scope: string; generatedAt: string; batches: Batch[] }

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const doltBin = arg("--dolt-bin") ?? "dolt";
const doltRoot = path.resolve(arg("--dolt-root") ?? (process.platform === "win32" ? "D:\\research\\dolt\\options" : "worker/cache/dolt/options"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv" : "worker/cache/options-dolthub/export"));
const currentYear = new Date().getUTCFullYear();
const years = arg("--years")?.split(",").map(Number) ?? Array.from({ length: currentYear - 2019 + 1 }, (_, index) => 2019 + index);
if (years.some((year) => !Number.isInteger(year) || year < 2019 || year > currentYear)) throw new Error(`Years must be within 2019..${currentYear}`);
const only = arg("--only")?.toUpperCase().split(",") ?? null;
const prog = startProgress("dolt-export-dates", `root ${doltRoot} · out ${outRoot} · years ${years.join(",")}`);

if (!existsSync(path.join(doltRoot, ".dolt"))) throw new Error(`Dolt clone not found at ${doltRoot}; expected .dolt directory`);
prog.log(execFileSync(doltBin, ["version"], { encoding: "utf8" }).split(/\r?\n/)[0]);
if (!isAllowedOutputRoot(outRoot)) throw new Error("Windows export is allowed only on D:. Pass --out D:\\research\\alpha-engine\\options-iv");
mkdirSync(outRoot, { recursive: true });
const space = statfsSync(realpathSync(outRoot));
if (space.bavail * space.bsize < 20 * 1024 ** 3) throw new Error("At least 20 GB free space is required on the export volume");

const dolt = (sql: string) => execFileSync(doltBin, ["sql", "-q", sql, "-r", "csv"], { cwd: doltRoot, encoding: "utf8", maxBuffer: 1024 ** 3 });
const manifestPath = path.join(outRoot, "manifest.json");
const manifest: Manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest
  : { source: "post-no-preference/options", scope: "mid-DTE IV only; no volume/OI/spot", generatedAt: new Date().toISOString(), batches: [] };
const finished = new Map(manifest.batches.filter((batch) => batch.status === "done" || batch.status === "empty").map((batch) => [`${batch.ticker}|${batch.year}`, batch]));

// Tickers: the daily price series that DoltHub lists on the clone's latest date (class shares as BRK.B there).
const latest = dolt("SELECT MAX(date) AS d FROM option_chain WHERE date >= '2026-01-01'").split(/\r?\n/)[1]?.trim();
if (!latest || !/^\d{4}-\d{2}-\d{2}$/.test(latest)) throw new Error("Could not read the clone's latest date");
const listed = new Set(dolt(`SELECT act_symbol FROM option_chain WHERE date = '${latest}' GROUP BY act_symbol`).split(/\r?\n/).slice(1).filter(Boolean));
const series = schwabPriceSeries().map((entry) => ({ ticker: entry.ticker, symbol: entry.ticker.replace(/-/g, ".") })).filter((entry) => !only || only.includes(entry.ticker));
const universe = series.filter((entry) => listed.has(entry.symbol) || [...finished.keys()].some((key) => key.startsWith(`${entry.ticker}|`)));
const notListed = series.filter((entry) => !universe.includes(entry)).map((entry) => entry.ticker);
prog.log(`clone latest date ${latest} · ${universe.length} tickers · not listed by DoltHub: ${notListed.join(", ") || "none"}`);

const report: any = { schemaVersion: 1, generatedAt: new Date().toISOString(), doltRoot, outRoot, cloneLatestDate: latest, tickers: universe.length, notListed, years: [] };
const reportPath = path.join(outRoot, "export-dates-report.json");
const tmpOf = (ticker: string, year: number, check: boolean) => path.join(outRoot, ticker, `${year}.csv.${check ? "check" : "tmp"}`);

for (const year of years) {
  const started = Date.now();
  const pending = universe.filter((entry) => !finished.has(`${entry.ticker}|${year}`));
  const checks = universe.filter((entry) => finished.get(`${entry.ticker}|${year}`)?.status === "done");
  if (!pending.length) { prog.log(`${year}: nothing pending`); continue; }
  const dateText = dolt(`SELECT date FROM option_chain WHERE date BETWEEN '${year}-01-01' AND '${year}-12-31' GROUP BY date ORDER BY date`);
  const dates = dateText.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line));
  prog.log(`${year}: ${dates.length} snapshot dates · ${pending.length} tickers to export · ${checks.length} existing files to rebuild as a check`);
  const work = [...pending.map((entry) => ({ ...entry, check: false })), ...checks.map((entry) => ({ ...entry, check: true }))];
  const byTicker = new Map(work.map((entry) => [entry.symbol, entry]));
  const stats = new Map(work.map((entry) => [entry.ticker, { rows: 0, firstDate: null as string | null, lastDate: null as string | null }]));
  for (const entry of work) {
    mkdirSync(path.join(outRoot, entry.ticker), { recursive: true });
    writeFileSync(tmpOf(entry.ticker, year, entry.check), `${DOLT_CSV_HEADER}\n`);
  }
  const symbols = work.map((entry) => entry.symbol);
  for (const [index, date] of dates.entries()) {
    for (const [symbol, lines] of splitBySymbol(dolt(dateSql(date, symbols)))) {
      const entry = byTicker.get(symbol);
      if (!entry) throw new Error(`Unexpected symbol ${symbol} on ${date}`);
      appendFileSync(tmpOf(entry.ticker, year, entry.check), `${lines.join("\n")}\n`);
      const stat = stats.get(entry.ticker)!;
      stat.rows += lines.length;
      stat.firstDate ??= date;
      stat.lastDate = date;
    }
    if ((index + 1) % 20 === 0 || index === dates.length - 1) prog.item(index + 1, dates.length, `${year} ${date}`);
  }
  const batches: Batch[] = [];
  for (const entry of pending) {
    const tmp = tmpOf(entry.ticker, year, false), rel = `${entry.ticker}/${year}.csv`, stat = stats.get(entry.ticker)!;
    if (!stat.rows) {
      rmSync(tmp, { force: true });
      batches.push({ ticker: entry.ticker, year, file: rel, status: "empty", rows: 0, firstDate: null, lastDate: null, sha256: null });
      continue;
    }
    renameSync(tmp, path.join(outRoot, rel));
    batches.push({ ticker: entry.ticker, year, file: rel, status: "done", ...stat, sha256: await sha256File(path.join(outRoot, rel)) });
  }
  const mismatches: { ticker: string; expected: string | null; rebuilt: string; rows: number }[] = [];
  for (const entry of checks) {
    const tmp = tmpOf(entry.ticker, year, true), expected = finished.get(`${entry.ticker}|${year}`)!;
    const rebuilt = await sha256File(tmp);
    if (rebuilt !== expected.sha256) mismatches.push({ ticker: entry.ticker, expected: expected.sha256, rebuilt, rows: stats.get(entry.ticker)!.rows });
    rmSync(tmp, { force: true });
  }
  manifest.batches = mergeBatches(manifest.batches, batches);
  manifest.generatedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest, true);
  for (const batch of batches) finished.set(`${batch.ticker}|${batch.year}`, batch);
  const summary = { year, dates: dates.length, exported: batches.filter((batch) => batch.status === "done").length, empty: batches.filter((batch) => batch.status === "empty").length, rows: batches.reduce((sum, batch) => sum + batch.rows, 0), checked: checks.length, mismatches, seconds: Math.round((Date.now() - started) / 1000) };
  report.years.push(summary);
  writeJsonAtomic(reportPath, report, true);
  prog.log(`${year}: ${summary.exported} exported · ${summary.empty} empty · ${summary.rows} rows · check ${checks.length - mismatches.length}/${checks.length} identical · ${summary.seconds} s`);
}
const mismatched = report.years.reduce((sum: number, year: any) => sum + year.mismatches.length, 0);
prog.done(`${report.years.length} year(s) exported · ${mismatched} check mismatches · report ${reportPath}`);
if (mismatched) process.exitCode = 1;
