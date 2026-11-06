import "dotenv/config";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { macroPoints, prices } from "@db/schema";
import { backfillMacroVintageSeries, prepareMacroVintageBackfill, type NormalizedMacroVintageRow } from "../worker/lib/macro-vintage-backfill";
import { ingestMacroPoints } from "../api/services/macro";
import { dailyPrice } from "../api/services/daily-price";
import { completeOfficialDailyBar, officialBarEnrichment, type OfficialDailyBar } from "../worker/lib/schwab-daily";

const root = path.resolve(process.env.REVIEWED_SYNC_ROOT ?? "worker/.runs/reviewed-sync-2026-11-05/package");
const db = getDb();
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const outDir = path.resolve(`worker/.runs/reviewed-sync-apply-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const context = JSON.parse(readFileSync(path.join(root, "worker/.runs/local-generated/reviewed-sync-context-macro.json"), "utf8"));
const apply = process.argv.includes("--apply");
const pricesOnly = process.argv.includes("--prices-only");
const results: Record<string, unknown> = {};

for (const file of manifest.files) {
  const filePath = path.join(root, file.archivePath);
  if (!existsSync(filePath) || readFileSync(filePath).length !== file.bytes || sha256(readFileSync(filePath)) !== file.sha256) {
    throw new Error(`Artifact validation failed: ${file.archivePath}`);
  }
}
for (const series of context.macroSeries) {
  const file = path.join(root, "normalized/fred", `${series.seriesId}.json`);
  const rows = JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroVintageRow[];
  if (rows.length !== series.rows || sha256(readFileSync(file)) !== series.sha256 || readFileSync(file).length !== series.byteSize) {
    throw new Error(`Normalized series validation failed: ${series.seriesId}`);
  }
  if (new Set(rows.map((row) => row.sourceHash)).size !== 1) throw new Error(`Expected one source hash for ${series.seriesId}`);
}

const backupDir = path.join(outDir, "backup");
mkdirSync(backupDir, { recursive: true });
const currentMacro = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
const currentPrices = await db.select().from(prices).orderBy(asc(prices.id));
writeFileSync(path.join(backupDir, "backup-macro-points.json"), JSON.stringify(currentMacro, null, 2) + "\n");
writeFileSync(path.join(backupDir, "backup-prices.json"), JSON.stringify(currentPrices, null, 2) + "\n");
for (const relative of ["schwab-context.json", "company-exposures.json", "macro-scenarios.json", "universe-coverage-50.json", "daily-prices-schwab.json"]) {
  const source = path.join("public/reports", relative);
  if (existsSync(source)) cpSync(source, path.join(backupDir, relative));
}

const daily = JSON.parse(readFileSync(path.join(root, "public/reports/daily-prices-schwab.json"), "utf8"));
if (daily.schemaVersion !== 2) throw new Error("Expected schema v2 with two complete official daily bars per company");
if (daily.companies.length !== 50 || new Set(daily.companies.map((row: any) => row.cik)).size !== 50) throw new Error("Expected 50 official closes");
for (const row of daily.companies) {
  if (row.status !== "collected" || row.quality !== "official_close" || !Number.isFinite(row.close) || row.close <= 0 || !row.sourceSha256) {
    throw new Error(`Invalid official close for ${row.ticker}`);
  }
  if (!Array.isArray(row.bars) || row.bars.length !== 2) throw new Error(`Expected previous and latest official bars for ${row.ticker}`);
  const [previous, latest] = row.bars as OfficialDailyBar[];
  if (previous.date !== row.previousDate || latest.date !== row.date || previous.date >= latest.date || latest.close !== row.close || previous.close !== row.previousClose) {
    throw new Error(`Official previous/latest bar mismatch for ${row.ticker}`);
  }
  for (const bar of row.bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || !completeOfficialDailyBar(bar) || !Number.isFinite(Date.parse(String(bar.fetchedAt ?? row.fetchedAt)))) {
      throw new Error(`Incomplete official OHLCV for ${row.ticker}/${bar.date}`);
    }
    if (Date.parse(bar.date) > Date.parse(daily.generatedAt)) throw new Error(`Future close for ${row.ticker}`);
  }
}

if (apply && !pricesOnly) {
  for (const series of context.macroSeries) {
    const archiveRows = JSON.parse(readFileSync(path.join(root, "normalized/fred", `${series.seriesId}.json`), "utf8")) as NormalizedMacroVintageRow[];
    const plan = prepareMacroVintageBackfill(series.seriesId, archiveRows, currentMacro.filter((row) => row.seriesId === series.seriesId), new Date().toISOString());
    results[series.seriesId] = await backfillMacroVintageSeries(plan, ingestMacroPoints);
  }
}
if (apply && pricesOnly) {
  results.macroSeriesSkipped = { reason: "Previously applied and independently verified; artifact hashes revalidated", series: context.macroSeries.map((row: any) => row.seriesId) };
}
if (apply) {
  results.dailyPrices = await db.transaction(async (tx) => {
    let inserted = 0;
    let enriched = 0;
    for (const row of daily.companies) {
      for (const bar of row.bars as OfficialDailyBar[]) {
        const existing = await tx.select().from(prices).where(and(eq(prices.cik, row.cik), eq(prices.date, bar.date), eq(prices.source, "schwab")));
        if (existing.length > 1) throw new Error(`Duplicate Schwab close for ${row.ticker}/${bar.date}`);
        if (existing.length === 1) {
          const current = existing[0];
          const patch = officialBarEnrichment({ ...current, ticker: row.ticker }, bar);
          if (Object.keys(patch).length > 0) {
            await tx.update(prices).set(patch).where(eq(prices.id, current.id));
            enriched++;
          }
          continue;
        }
        await tx.insert(prices).values({
          cik: row.cik,
          ticker: row.ticker,
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          adjClose: null,
          volume: bar.volume,
          source: "schwab",
          fetchedAt: new Date(bar.fetchedAt ?? row.fetchedAt),
        });
        inserted++;
      }
    }
    return { insertedRows: inserted, enrichedRows: enriched, collected: daily.companies.length };
  });
  const quoteChecks: any[] = [];
  for (const row of daily.companies) {
    const [previous, latest] = row.bars as OfficialDailyBar[];
    const current = await dailyPrice(row.cik, latest.date, new Date().toISOString());
    const prior = await dailyPrice(row.cik, previous.date, new Date().toISOString());
    const pass = current.status === "ready" && prior.status === "ready" && current.source === "schwab" && prior.source === "schwab" &&
      current.price === latest.close && prior.price === previous.close && current.bar?.open === latest.open && current.bar?.high === latest.high &&
      current.bar?.low === latest.low && current.bar?.volume === latest.volume && current.bar?.adjClose === null;
    quoteChecks.push({ cik: row.cik, ticker: row.ticker, date: latest.date, previousDate: previous.date, price: current.price, previousClose: prior.price, change: current.price! - prior.price!, pass });
    if (!pass) throw new Error(`Canonical same-source quote verification failed for ${row.ticker}`);
  }
  results.dailyPriceChecks = { passed: quoteChecks.filter((row) => row.pass).length, failed: quoteChecks.filter((row) => !row.pass).length, companies: quoteChecks };
  for (const relative of ["schwab-context.json", "company-exposures.json", "macro-scenarios.json", "universe-coverage-50.json", "daily-prices-schwab.json"]) {
    cpSync(path.join(root, "public/reports", relative), path.join("public/reports", relative));
  }
  results.artifacts = ["schwab-context.json", "company-exposures.json", "macro-scenarios.json", "universe-coverage-50.json", "daily-prices-schwab.json"];
}

const [macroAfter]: any = await db.execute(sql`SELECT COUNT(*) AS n FROM macro_points`);
const [priceAfter]: any = await db.execute(sql`SELECT COUNT(*) AS n FROM prices`);
const [duplicates]: any = await db.execute(sql`SELECT seriesId, date, realtimeStart, COUNT(*) n FROM macro_points GROUP BY seriesId, date, realtimeStart HAVING COUNT(*) > 1 LIMIT 1`);
const [inversions]: any = await db.execute(sql`SELECT COUNT(*) n FROM macro_points WHERE realtimeStart IS NULL OR (realtimeEnd IS NOT NULL AND realtimeStart > realtimeEnd)`);
const [selectedAfter]: any = await db.execute(sql`SELECT COUNT(*) n FROM macro_points WHERE realtimeStart > ${new Date().toISOString().slice(0, 10)}`);
const [csco]: any = await db.execute(sql`SELECT ticker, date, close, source, fetchedAt FROM prices WHERE cik=858877 AND date="2026-11-04" AND source="schwab" LIMIT 1`);
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "preflight",
  backupDir,
  macroBefore: currentMacro.length,
  macroAfter: Number(macroAfter[0].n),
  pricesBefore: currentPrices.length,
  pricesAfter: Number(priceAfter[0].n),
  deletedRows: 0,
  duplicates: duplicates.length,
  availabilityInversions: Number(inversions[0].n),
  selectedAfterAnchor: Number(selectedAfter[0].n),
  csco: csco[0] ?? null,
  results,
};
writeFileSync(path.join(outDir, "apply-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ outDir, mode: result.mode, macroAfter: result.macroAfter, pricesAfter: result.pricesAfter, deletedRows: 0, duplicates: result.duplicates, availabilityInversions: result.availabilityInversions, selectedAfterAnchor: result.selectedAfterAnchor, csco: result.csco }, null, 2));
await db.$client.end();
