/**
 * Stores every completed official Schwab daily candle in local prices (source "schwab") for every series of the
 * Schwab archives. Each daily price-history file covers about a month, so a day that one run misses is filled by
 * the next; --history-dir loads the one-off backfill files instead. A stored close is never changed: a candle whose
 * close differs is reported as a conflict and left out, and other field differences are listed.
 * Local only: nothing here enters the operational push lane.
 *
 * Usage: npx tsx worker/schwab-daily-bars.mts [--history-dir <dir>] [--root <dir>]... [--dry-run]
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import type { PriceBar } from "../api/services/prices";
import { completeOfficialDailyBar, latestCompletedSchwabDailyDate, officialDailyBars } from "./lib/schwab-daily";
import { missingSessions, planSchwabBars } from "./lib/schwab-daily-bars";
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
const conflicts: any[] = [], differences: any[] = [];
let inserted = 0, enriched = 0;
try {
  for (const { ticker, file } of files.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const entry = series.get(ticker);
    if (!entry) { skipped.push({ ticker, reason: "not a daily price series (outside the research universe, the S&P snapshot and the funds)" }); continue; }
    try {
      const bars: PriceBar[] = officialDailyBars(JSON.parse(readFileSync(file, "utf8")), latestDate).filter(completeOfficialDailyBar);
      if (!bars.length) { skipped.push({ ticker, reason: "no completed official candle" }); continue; }
      const [rows]: any = await db.execute(sql`SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d, open, high, low, close, adjClose, volume FROM prices WHERE cik=${entry.priceKey} AND source="schwab" AND date >= ${bars[0].date} ORDER BY date`);
      const stored: PriceBar[] = rows.map((row: any) => ({ date: row.d, open: number(row.open), high: number(row.high), low: number(row.low), close: number(row.close), adjClose: number(row.adjClose), volume: number(row.volume) }));
      const plan = planSchwabBars(stored, bars);
      if (!dryRun) {
        for (let offset = 0; offset < plan.insert.length; offset += 500) {
          const slice = plan.insert.slice(offset, offset + 500);
          await db.execute(sql`INSERT INTO prices (cik, ticker, date, open, high, low, close, adjClose, volume, source) VALUES ${sql.join(slice.map((bar) => sql`(${entry.priceKey}, ${ticker}, ${bar.date}, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, NULL, ${bar.volume}, "schwab")`), sql`, `)} ON DUPLICATE KEY UPDATE id = id`);
        }
        for (const { date, patch } of plan.enrich) {
          await db.execute(sql`UPDATE prices SET open = COALESCE(open, ${patch.open ?? null}), high = COALESCE(high, ${patch.high ?? null}), low = COALESCE(low, ${patch.low ?? null}), volume = COALESCE(volume, ${patch.volume ?? null}) WHERE cik=${entry.priceKey} AND date=${date} AND source="schwab"`);
        }
      }
      inserted += plan.insert.length;
      enriched += plan.enrich.length;
      conflicts.push(...plan.closeConflicts.map((row) => ({ ticker, ...row })));
      differences.push(...plan.fieldDifferences.map((row) => ({ ticker, ...row })));
      perSeries.push({ ticker, priceKey: entry.priceKey, firstDate: bars[0].date, lastDate: bars.at(-1)!.date, candles: bars.length, inserted: plan.insert.length, enriched: plan.enrich.length, unchanged: plan.unchanged, closeConflicts: plan.closeConflicts.length });
    } catch (error) {
      errors.push({ ticker, error: String(error).slice(0, 240) });
    }
  }

  // Holes: sessions of SPY's Schwab calendar that a series lacks inside its own span since the earliest candle read.
  const from = perSeries.reduce((min, row) => (row.firstDate < min ? row.firstDate : min), latestDate);
  const [calendarRows]: any = await db.execute(sql`SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM prices WHERE cik=0 AND source="schwab" AND date >= ${from} ORDER BY date`);
  const calendar = calendarRows.map((row: any) => row.d);
  const holes: { ticker: string; missing: number; first: string[] }[] = [];
  for (const row of perSeries) {
    const [dateRows]: any = await db.execute(sql`SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM prices WHERE cik=${row.priceKey} AND source="schwab" AND date >= ${from} ORDER BY date`);
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
    inserted,
    enriched,
    closeConflicts: conflicts,
    fieldDifferences: { count: differences.length, first: differences.slice(0, 50) },
    holes: { calendar: "SPY Schwab sessions", from, calendarSessions: calendar.length, seriesWithHoles: holes.length, list: holes },
    skipped,
    errors,
    notes,
    perSeries,
    productionWrite: false,
  };
  writeJsonAtomic(`worker/.runs/local-generated/schwab-daily-bars${historyDir ? ".backfill" : ""}.json`, summary, true);
  console.log(JSON.stringify({ files: files.length, series: perSeries.length, inserted, enriched, closeConflicts: conflicts.length, fieldDifferences: differences.length, seriesWithHoles: holes.length, skipped: skipped.length, errors: errors.length, latestCompletedDate: latestDate, dryRun }, null, 2));
  if (errors.length || conflicts.length) process.exitCode = 1;
} finally {
  await db.$client.end();
}
