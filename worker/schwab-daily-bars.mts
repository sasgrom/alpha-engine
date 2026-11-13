/**
 * Stores every completed official Schwab daily candle in local prices for every series of the Schwab archives. Each
 * daily price-history file covers about a month, so a day that one run misses is filled by the next; --history-dir
 * loads the one-off backfill files instead. Dates after the series' last Stooq bar are stored as source "schwab";
 * dates the dividend-adjusted Stooq history already covers are stored as "schwab-hist", because the app lets Schwab
 * win on its dates and a raw bar inside the adjusted history would be a false step. A stored close is never changed
 * one by one: a candle whose close differs is reported as a conflict and left out, and other field differences are
 * listed. A split is the exception: when Schwab re-bases a series' whole history (every stored close before one date
 * differs by one factor, see basisChange), the stored history before that date is re-based by the factor in every
 * source (Stooq, schwab-hist, schwab), the event is appended to worker/.runs/price-adjustments.jsonl, and the run goes
 * on instead of failing the chain (a split used to stop it for up to a month).
 * Local only: nothing here enters the operational push lane.
 *
 * Usage: npx tsx worker/schwab-daily-bars.mts [--history-dir <dir>] [--root <dir>]... [--dry-run]
 */
import "dotenv/config";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import type { PriceBar } from "../api/services/prices";
import { completeOfficialDailyBar, latestCompletedSchwabDailyDate, officialDailyBars } from "./lib/schwab-daily";
import { basisChange, missingSessions, planSchwabBars, splitAtStooqEnd } from "./lib/schwab-daily-bars";
import { schwabPriceSeries } from "./lib/schwab-price-series";
import { writeJsonAtomic } from "./lib/json-file";

const args = process.argv.slice(2);
const values = (name: string) => args.flatMap((value, index) => (args[index - 1] === name ? [value] : []));
const historyDir = values("--history-dir")[0] ?? null;
const roots = values("--root").length ? values("--root") : ["D:/research/alpha-engine/schwab", "D:/research/alpha-engine/schwab-sp500"];
const dryRun = args.includes("--dry-run");
const generatedAt = new Date().toISOString();
const latestDate = latestCompletedSchwabDailyDate(new Date());
const series = new Map(schwabPriceSeries().map((entry) => [entry.ticker, entry]));
const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const files: { ticker: string; file: string }[] = [];
const notes: string[] = [];
if (historyDir) {
  for (const name of readdirSync(historyDir)) if (name.endsWith(".json") && !name.startsWith("_")) files.push({ ticker: name.slice(0, -5), file: path.join(historyDir, name) });
} else {
  for (const root of roots) {
    const dir = path.join(root, "pricehistory");
    if (!existsSync(dir)) { notes.push(`${dir} is absent`); continue; }
    for (const name of readdirSync(dir)) if (name.endsWith(".json")) files.push({ ticker: name.slice(0, -5), file: path.join(dir, name) });
  }
}

const db = getDb();
const perSeries: any[] = [], skipped: { ticker: string; reason: string }[] = [], errors: { ticker: string; error: string }[] = [];
const conflicts: any[] = [], differences: any[] = [], basisChanges: any[] = [];
let inserted = 0, insertedHistory = 0, enriched = 0;
try {
  for (const { ticker, file } of files.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const entry = series.get(ticker);
    if (!entry) { skipped.push({ ticker, reason: "not a daily price series (outside the research universe, the S&P snapshot and the funds)" }); continue; }
    try {
      const bars: PriceBar[] = officialDailyBars(JSON.parse(readFileSync(file, "utf8")), latestDate).filter(completeOfficialDailyBar);
      if (!bars.length) { skipped.push({ ticker, reason: "no completed official candle" }); continue; }
      const [lastRows]: any = await db.execute(sql`SELECT DATE_FORMAT(MAX(date),'%Y-%m-%d') AS d FROM prices WHERE cik=${entry.priceKey} AND source="stooq"`);
      const lastStooq: string | null = lastRows[0]?.d ?? null;
      const parts = splitAtStooqEnd(bars, lastStooq);
      const row: any = { ticker, priceKey: entry.priceKey, firstDate: bars[0].date, lastDate: bars.at(-1)!.date, candles: bars.length, lastStooq, inserted: 0, insertedHistory: 0, enriched: 0, unchanged: 0, closeConflicts: 0 };
      const storedOf = async (source: string, from: string): Promise<PriceBar[]> => {
        const [rows]: any = await db.execute(sql`SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d, open, high, low, close, adjClose, volume FROM prices WHERE cik=${entry.priceKey} AND source=${source} AND date >= ${from} ORDER BY date`);
        return rows.map((item: any) => ({ date: item.d, open: number(item.open), high: number(item.high), low: number(item.low), close: number(item.close), adjClose: number(item.adjClose), volume: number(item.volume) }));
      };
      // a split (or an adjustment Schwab applies to the whole history): the stored history before the first session on
      // the new basis is re-based by the same factor in every source, so the series stays continuous and the chain goes on
      const already = [...(parts.history.length ? await storedOf("schwab-hist", parts.history[0].date) : []), ...(parts.current.length ? await storedOf("schwab", parts.current[0].date) : [])];
      const change = basisChange(already, bars);
      if (change) {
        const event: any = { ticker, priceKey: entry.priceKey, ...change, detectedAt: generatedAt, dryRun, rebased: {} };
        if (!dryRun) {
          const [span]: any = await db.execute(sql`SELECT YEAR(MIN(date)) AS y FROM prices WHERE cik=${entry.priceKey}`);
          for (const source of ["stooq", "schwab-hist", "schwab"]) {
            let rowsChanged = 0;
            for (let year = Number(span[0]?.y ?? change.firstNewBasisDate.slice(0, 4)); year <= Number(change.firstNewBasisDate.slice(0, 4)); year++) {
              const until = `${year + 1}-01-01` < change.firstNewBasisDate ? `${year + 1}-01-01` : change.firstNewBasisDate;
              const [result]: any = await db.execute(sql`UPDATE prices SET open = open * ${change.ratio}, high = high * ${change.ratio}, low = low * ${change.ratio}, close = close * ${change.ratio}, adjClose = adjClose * ${change.ratio}, volume = ROUND(volume / ${change.ratio}) WHERE cik=${entry.priceKey} AND source=${source} AND date >= ${`${year}-01-01`} AND date < ${until}`);
              rowsChanged += Number(result?.affectedRows ?? 0);
            }
            event.rebased[source] = rowsChanged;
          }
        }
        if (!dryRun) appendFileSync("worker/.runs/price-adjustments.jsonl", JSON.stringify(event) + "\n");
        basisChanges.push(event);
        row.basisChange = event;
      }
      for (const [source, part] of [["schwab-hist", parts.history], ["schwab", parts.current]] as const) {
        if (!part.length) continue;
        const stored = await storedOf(source, part[0].date);
        const plan = planSchwabBars(stored, part);
        if (!dryRun) {
          for (let offset = 0; offset < plan.insert.length; offset += 500) {
            const slice = plan.insert.slice(offset, offset + 500);
            await db.execute(sql`INSERT INTO prices (cik, ticker, date, open, high, low, close, adjClose, volume, source) VALUES ${sql.join(slice.map((bar) => sql`(${entry.priceKey}, ${ticker}, ${bar.date}, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, NULL, ${bar.volume}, ${source})`), sql`, `)} ON DUPLICATE KEY UPDATE id = id`);
          }
          for (const { date, patch } of plan.enrich) {
            await db.execute(sql`UPDATE prices SET open = COALESCE(open, ${patch.open ?? null}), high = COALESCE(high, ${patch.high ?? null}), low = COALESCE(low, ${patch.low ?? null}), volume = COALESCE(volume, ${patch.volume ?? null}) WHERE cik=${entry.priceKey} AND date=${date} AND source=${source}`);
          }
        }
        if (source === "schwab") row.inserted += plan.insert.length;
        else row.insertedHistory += plan.insert.length;
        row.enriched += plan.enrich.length;
        row.unchanged += plan.unchanged;
        row.closeConflicts += plan.closeConflicts.length;
        conflicts.push(...plan.closeConflicts.map((item) => ({ ticker, source, ...item })));
        differences.push(...plan.fieldDifferences.map((item) => ({ ticker, source, ...item })));
      }
      inserted += row.inserted;
      insertedHistory += row.insertedHistory;
      enriched += row.enriched;
      perSeries.push(row);
    } catch (error) {
      errors.push({ ticker, error: String(error).slice(0, 240) });
    }
  }

  // Holes in what the app and the engine read (Stooq history, Schwab after it): sessions of SPY's combined calendar
  // that a series lacks inside its own span since the earliest candle read.
  const from = perSeries.reduce((min, row) => (row.firstDate < min ? row.firstDate : min), latestDate);
  const [calendarRows]: any = await db.execute(sql`SELECT DISTINCT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM prices WHERE cik=0 AND source IN ("stooq", "schwab") AND date >= ${from}`);
  const calendar = calendarRows.map((row: any) => row.d);
  const holes: { ticker: string; missing: number; first: string[] }[] = [];
  for (const row of perSeries) {
    const [dateRows]: any = await db.execute(sql`SELECT DISTINCT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM prices WHERE cik=${row.priceKey} AND source IN ("stooq", "schwab") AND date >= ${from}`);
    const missing = missingSessions(dateRows.map((item: any) => item.d), calendar, from);
    if (missing.length) holes.push({ ticker: row.ticker, missing: missing.length, first: missing.slice(0, 5) });
  }
  const summary = {
    schemaVersion: 1,
    generatedAt,
    mode: historyDir ? { historyDir } : { roots },
    dryRun,
    latestCompletedDate: latestDate,
    files: files.length,
    series: perSeries.length,
    sourcePolicy: "Bars after a series' last Stooq bar are stored as schwab (read by the app, which lets Schwab win on its dates); bars on dates the Stooq history covers are stored as schwab-hist, so the dividend-adjusted history gets no raw step",
    inserted,
    insertedHistory,
    enriched,
    closeConflicts: conflicts,
    basisChanges,
    fieldDifferences: { count: differences.length, first: differences.slice(0, 50) },
    holes: { calendar: "SPY Schwab sessions", from, calendarSessions: calendar.length, seriesWithHoles: holes.length, list: holes },
    skipped,
    errors,
    notes,
    perSeries,
    productionWrite: false,
  };
  writeJsonAtomic(`worker/.runs/local-generated/schwab-daily-bars${historyDir ? ".backfill" : ""}.json`, summary, true);
  for (const event of basisChanges) console.log(`basis change: ${event.ticker} ×${event.ratio} before ${event.firstNewBasisDate} (${event.dates} stored dates moved)${event.dryRun ? " — dry run, nothing re-based" : `; re-based ${JSON.stringify(event.rebased)}`}`);
  console.log(JSON.stringify({ files: files.length, series: perSeries.length, inserted, insertedHistory, enriched, closeConflicts: conflicts.length, basisChanges: basisChanges.length, fieldDifferences: differences.length, seriesWithHoles: holes.length, skipped: skipped.length, errors: errors.length, latestCompletedDate: latestDate, dryRun }, null, 2));
  if (errors.length || conflicts.length) process.exitCode = 1;
} finally {
  await db.$client.end();
}
