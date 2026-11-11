import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import * as unzipper from "unzipper";
import { getDb } from "../api/queries/connection";
import { entryToTicker, parseMetastockDaily } from "../api/services/price-import";
import { upsertBars } from "../api/services/prices";
import { ETF_CIK_BY_TICKER, findBarQualityIssues, findDailyMoveOutliers, findSessionGaps, SECTOR_ETF_TICKERS, stooqPriceCik } from "../worker/lib/stooq-price-load";
import { writeJsonAtomic } from "../worker/lib/json-file";

const ARCHIVE = process.argv.includes("--file") ? process.argv[process.argv.indexOf("--file") + 1] : "D:/stooq data 102726/d_us_txt.zip";
const canonicalRow = (row: any) => JSON.stringify({ id: row.id, cik: row.cik, ticker: row.ticker, date: String(row.date).slice(0, 10), open: row.open, high: row.high, low: row.low, close: row.close, adjClose: row.adjClose, volume: row.volume, source: row.source });
const rowHash = (row: any) => createHash("sha256").update(canonicalRow(row)).digest("hex");

async function main() {
  const db = getDb();
  try {
    const edgar = JSON.parse(readFileSync("worker/edgar-universe.json", "utf8")) as { cik: number; ticker: string }[];
    const research = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
    const wanted = new Map<string, number>();
    for (const company of [...edgar, ...research]) wanted.set(company.ticker, stooqPriceCik(company.cik, company.ticker));
    wanted.set("SPY", 0);
    for (const ticker of SECTOR_ETF_TICKERS) wanted.set(ticker, ETF_CIK_BY_TICKER[ticker]);
    const requestedTickers = new Set(wanted.keys());
    const startedAt = new Date().toISOString();
    const archiveBytes = readFileSync(ARCHIVE);
    const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
    const beforeHashes = new Map<number, string>();
    let beforeCount = 0;
    let lastBeforeId = 0;
    while (true) {
      const [rows]: any = await db.execute(sql`SELECT id, cik, ticker, date, open, high, low, close, adjClose, volume, source FROM prices WHERE source="stooq" AND id > ${lastBeforeId} ORDER BY id LIMIT 10000`);
      if (!rows.length) break;
      for (const row of rows) beforeHashes.set(Number(row.id), rowHash(row));
      beforeCount += rows.length;
      lastBeforeId = Number(rows.at(-1).id);
      if (rows.length < 10000) break;
    }
    const perTicker = new Map<string, { cik: number; ticker: string; firstDate: string; lastDate: string; rowCount: number }>();
    const matched = new Set<string>();
    const gaps: any[] = [], nonPositive: any[] = [], highLow: any[] = [], duplicateDates: any[] = [], largeMoves: any[] = [];
    const zip = await unzipper.Open.buffer(archiveBytes);
    for (const entry of zip.files) {
      if (entry.type !== "File") continue;
      const sourceTicker = entryToTicker(entry.path, requestedTickers);
      if (!sourceTicker) continue;
      const cik = wanted.get(sourceTicker)!;
      const bars = parseMetastockDaily((await entry.buffer()).toString("utf8"));
      if (!bars.length) continue;
      const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
      perTicker.set(sourceTicker, { cik, ticker: sourceTicker, firstDate: sorted[0].date, lastDate: sorted.at(-1)!.date, rowCount: bars.length });
      matched.add(sourceTicker);
      await upsertBars(cik, sourceTicker, bars, "stooq");
      const quality = findBarQualityIssues(sourceTicker, bars);
      nonPositive.push(...quality.nonPositive.map((row) => ({ ticker: sourceTicker, ...row })));
      highLow.push(...quality.highLow.map((row) => ({ ticker: sourceTicker, ...row })));
      duplicateDates.push(...quality.duplicateDates.map((date) => ({ ticker: sourceTicker, date })));
      largeMoves.push(...findDailyMoveOutliers(sourceTicker, bars));
    }
    const [spyRows]: any = await db.execute(sql`SELECT DISTINCT date FROM prices WHERE cik=0 AND source="stooq" ORDER BY date`);
    const spyDates = spyRows.map((row: any) => String(row.date).slice(0, 10));
    const readbackMismatches: any[] = [];
    for (const [ticker, value] of perTicker) {
      const [bars]: any = await db.execute(sql`SELECT date, open, high, low, close, adjClose, volume FROM prices WHERE cik=${value.cik} AND ticker=${value.ticker} AND source="stooq" ORDER BY date`);
      const firstDate = bars.length ? String(bars[0].date).slice(0, 10) : null;
      const lastDate = bars.length ? String(bars.at(-1).date).slice(0, 10) : null;
      if (bars.length !== value.rowCount || firstDate !== value.firstDate || lastDate !== value.lastDate) {
        readbackMismatches.push({ ticker, cik: value.cik, archiveRows: value.rowCount, storedRows: bars.length, archiveFirstDate: value.firstDate, storedFirstDate: firstDate, archiveLastDate: value.lastDate, storedLastDate: lastDate });
      }
      gaps.push(...findSessionGaps(ticker, bars, spyDates));
    }
    const [afterCountRows]: any = await db.execute(sql`SELECT COUNT(*) AS rowsTotal FROM prices WHERE source="stooq"`);
    const afterCount = Number(afterCountRows[0].rowsTotal);
    const originalIds = [...beforeHashes.keys()];
    let missingOriginalIds = 0, differingBars = 0;
    for (let offset = 0; offset < originalIds.length; offset += 1000) {
      const ids = originalIds.slice(offset, offset + 1000);
      const [rows]: any = await db.execute(sql`SELECT id, cik, ticker, date, open, high, low, close, adjClose, volume, source FROM prices WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
      const afterHashes = new Map<number, string>();
      for (const row of rows) afterHashes.set(Number(row.id), rowHash(row));
      for (const id of ids) {
        if (!afterHashes.has(id)) missingOriginalIds++;
        else if (afterHashes.get(id) !== beforeHashes.get(id)) differingBars++;
      }
    }
    const [missingGics]: any = await db.execute(sql`SELECT cik, ticker FROM companies WHERE sector IS NULL OR sector = "" ORDER BY ticker`);
    const unmatched = [...requestedTickers].filter((ticker) => !matched.has(ticker)).map((ticker) => ({ ticker, reason: "No matching entry in the owner archive" }));
    const sp500Matched = new Set(edgar.map((row) => row.ticker).filter((ticker) => matched.has(ticker)));
    const sp500Unique = new Set(edgar.map((row) => row.ticker));
    const summary = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      loadStartedAt: startedAt,
      archive: { path: ARCHIVE, bytes: archiveBytes.length, sha256: archiveSha256, readStrategy: "single-buffered-read" },
      keyConvention: "SPY keeps cik=0; sector ETFs use -1001 through -1011. Second listings GOOG/FOX/NWS use -2001/-2002/-2003 because the bar key is (cik,date,source); primary listings retain the shared SEC CIK. Negative keys are local price-series identifiers, not SEC CIKs, and require no schema change",
      requested: requestedTickers.size,
      matched: matched.size,
      unmatched,
      sp500: { requested: sp500Unique.size, matched: sp500Matched.size, share: sp500Unique.size ? sp500Matched.size / sp500Unique.size : 0 },
      rowsWritten: afterCount - beforeCount,
      totalRows: afterCount,
      existingBars: { before: beforeCount, after: afterCount, missingOriginalIds, differingBars },
      readback: { verifiedTickers: perTicker.size - readbackMismatches.length, mismatches: readbackMismatches },
      perTicker: [...perTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)),
      quality: {
        gaps,
        nonPositive,
        highLow,
        duplicateDates,
        largeMoves: largeMoves.map((row) => ({ ...row, reviewOnly: true })),
        companiesWithoutGics: missingGics,
      },
      productionWrite: false,
      productionPushGuard: "prod-push builds pricesDaily from Schwab only, so these stooq rows cannot enter that lane; Stooq and Schwab remain separate by (cik,date,source)",
      knownLimits: [
        "The archive contains only tickers listed today, so the history describes survivors",
        "SPY and some tickers start on 2005-02-25 in this archive",
        "Bars after 2026-10-26 need a newer archive; this task does not fetch one",
      ],
    };
    writeJsonAtomic("research/engine/price-load-stooq-2026-10-27.summary.json", summary, true);
    console.log(JSON.stringify({ requested: summary.requested, matched: summary.matched, unmatched: unmatched.length, sp500Share: summary.sp500.share, rowsWritten: summary.rowsWritten, differingBars, missingOriginalIds, readbackMismatches: readbackMismatches.length, quality: { gaps: gaps.length, nonPositive: nonPositive.length, highLow: highLow.length, duplicateDates: duplicateDates.length, largeMoves: largeMoves.length, missingGics: missingGics.length } }, null, 2));
    if (readbackMismatches.length || missingOriginalIds || differingBars || summary.sp500.share < 0.98 || !matched.has("SPY") || SECTOR_ETF_TICKERS.some((ticker) => !matched.has(ticker))) throw new Error("Stooq load post-checks failed; inspect the summary");
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("load-stooq-prices.mts")) await main();
