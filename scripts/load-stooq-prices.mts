import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as unzipper from "unzipper";
import { getDb } from "../api/queries/connection";
import { entryToTicker, parseMetastockDaily } from "../api/services/price-import";
import { upsertBars, type PriceBar } from "../api/services/prices";
import { compareArchiveBars, ETF_CIK_BY_TICKER, findBarQualityIssues, findDailyMoveOutliers, findSessionGaps, listStooqTextFiles, SECTOR_ETF_TICKERS, stooqPriceCik, type ArchiveComparison } from "../worker/lib/stooq-price-load";
import { writeJsonAtomic } from "../worker/lib/json-file";

// Usage:
//   npx tsx scripts/load-stooq-prices.mts                                  first load from the 2026-10-27 zip (default)
//   npx tsx scripts/load-stooq-prices.mts --dir "<dump>/data/daily/us" --refresh [--dry-run]
// A newer dump re-adjusts whole histories for later splits and dividends. With --refresh such a series is replaced
// when the stored bars differ from the dump by one factor; any other difference is held for review and left unchanged.
const argValue = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const DIR = argValue("--dir");
const ARCHIVE = DIR ?? argValue("--file") ?? "D:/stooq data 102726/d_us_txt.zip";
const REFRESH = process.argv.includes("--refresh");
const DRY_RUN = process.argv.includes("--dry-run");
// --accept T1,T2: held series the owner reviewed and accepted in the archive's version (record the decision in the summary)
const ACCEPT = new Set((argValue("--accept") ?? "").split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const toBar = (row: any): PriceBar => ({ date: row.d, open: number(row.open), high: number(row.high), low: number(row.low), close: number(row.close), adjClose: number(row.adjClose), volume: number(row.volume) });
const sameBars = (a: PriceBar, b: PriceBar) => (["open", "high", "low", "close", "adjClose", "volume"] as const).every((field) => (a[field] === null || b[field] === null ? a[field] === b[field] : Math.abs(a[field]! - b[field]!) <= 1e-9 * Math.max(1, Math.abs(a[field]!), Math.abs(b[field]!))));

interface ArchiveFile { path: string; read: () => Promise<Buffer> }

async function openArchive(): Promise<{ files: ArchiveFile[]; identity: Record<string, unknown> }> {
  if (DIR) {
    const list = listStooqTextFiles(DIR);
    return { files: list.map((relative) => ({ path: relative, read: async () => readFileSync(path.join(DIR, relative)) })), identity: { path: DIR, kind: "directory", textFiles: list.length } };
  }
  const bytes = readFileSync(ARCHIVE);
  const zip = await unzipper.Open.buffer(bytes);
  return { files: zip.files.filter((entry) => entry.type === "File").map((entry) => ({ path: entry.path, read: () => entry.buffer() })), identity: { path: ARCHIVE, kind: "zip", bytes: bytes.length, sha256: sha256(bytes), readStrategy: "single-buffered-read" } };
}

async function storedBars(db: ReturnType<typeof getDb>, cik: number): Promise<PriceBar[]> {
  const [rows]: any = await db.execute(sql`SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d, open, high, low, close, adjClose, volume FROM prices WHERE cik=${cik} AND source="stooq" ORDER BY date`);
  return rows.map(toBar);
}

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
    const archive = await openArchive();

    // Candidate files per ticker; a ticker listed in two exchange folders keeps the file with the later last bar.
    const candidates = new Map<string, ArchiveFile[]>();
    for (const file of archive.files) {
      const ticker = entryToTicker(file.path, requestedTickers);
      if (ticker) candidates.set(ticker, [...(candidates.get(ticker) ?? []), file]);
    }
    const chosen = new Map<string, { file: ArchiveFile; bytes: Buffer; bars: PriceBar[] }>();
    const duplicates: { ticker: string; files: string[]; used: string }[] = [];
    for (const [ticker, files] of candidates) {
      const read = await Promise.all(files.map(async (file) => { const bytes = await file.read(); return { file, bytes, bars: parseMetastockDaily(bytes.toString("utf8")) }; }));
      const usable = read.filter((item) => item.bars.length).sort((a, b) => (b.bars.reduce((m, bar) => (bar.date > m ? bar.date : m), "") .localeCompare(a.bars.reduce((m, bar) => (bar.date > m ? bar.date : m), ""))) || b.bars.length - a.bars.length);
      if (!usable.length) continue;
      if (files.length > 1) duplicates.push({ ticker, files: files.map((file) => file.path), used: usable[0].file.path });
      chosen.set(ticker, usable[0]);
    }
    const usedLines = [...chosen.values()].map((item) => `${item.file.path}\t${sha256(item.bytes)}`).sort();
    const spyBars = chosen.get("SPY")?.bars ?? [];
    const archiveLastDate = spyBars.reduce((latest, bar) => (bar.date > latest ? bar.date : latest), "");
    const identity = { ...archive.identity, usedFiles: usedLines.length, usedBytes: [...chosen.values()].reduce((sum, item) => sum + item.bytes.length, 0), usedFilesSha256: sha256(usedLines.join("\n")), lastSpyDate: archiveLastDate || null };

    // Snapshot of every stored Stooq bar: id -> hash|cik|date, so the after-check can tell intended updates from accidents.
    const before = new Map<number, string>();
    if (!DRY_RUN) {
      let lastId = 0;
      while (true) {
        const [rows]: any = await db.execute(sql`SELECT id, cik, ticker, DATE_FORMAT(date,'%Y-%m-%d') AS d, open, high, low, close, adjClose, volume FROM prices WHERE source="stooq" AND id > ${lastId} ORDER BY id LIMIT 10000`);
        if (!rows.length) break;
        for (const row of rows) before.set(Number(row.id), `${sha256(JSON.stringify([row.ticker, row.open, row.high, row.low, row.close, row.adjClose, row.volume])).slice(0, 16)}|${row.cik}|${row.d}`);
        lastId = Number(rows.at(-1).id);
        if (rows.length < 10000) break;
      }
    }

    const perTicker: any[] = [];
    const comparisons = new Map<string, ArchiveComparison>();
    const intended = new Set<string>();
    const gaps: any[] = [], nonPositive: any[] = [], highLow: any[] = [], duplicateDates: any[] = [], largeMoves: any[] = [];
    const spyDates = spyBars.map((bar) => bar.date);
    let rowsInserted = 0, rowsUpdated = 0;
    for (const [ticker, item] of [...chosen].sort(([a], [b]) => a.localeCompare(b))) {
      const cik = wanted.get(ticker)!;
      const comparison = compareArchiveBars(await storedBars(db, cik), item.bars, { accept: REFRESH && ACCEPT.has(ticker) });
      comparisons.set(ticker, comparison);
      const accepted = comparison.kind === "new" || comparison.kind === "identical" || (REFRESH && (comparison.kind === "readjusted" || comparison.kind === "corrected" || Boolean(comparison.accepted)));
      const rows = accepted || (REFRESH && comparison.kind === "revised") ? comparison.rows : [];
      if (!DRY_RUN && rows.length) await upsertBars(cik, ticker, rows, "stooq");
      const updated = rows.length - Math.min(rows.length, comparison.kind === "new" ? rows.length : comparison.newDates);
      rowsInserted += rows.length - updated;
      rowsUpdated += updated;
      for (const bar of rows) intended.add(`${cik}|${bar.date}`);
      const sorted = [...item.bars].sort((a, b) => a.date.localeCompare(b.date));
      perTicker.push({ cik, ticker, firstDate: sorted[0].date, lastDate: sorted.at(-1)!.date, rowCount: sorted.length, kind: comparison.kind, accepted, newDatesAppended: accepted ? comparison.newDates > 0 : Boolean(comparison.newDatesAppended), newDates: comparison.newDates, updatedBars: updated, storedOnlyDates: comparison.storedOnlyDates.length });
      const quality = findBarQualityIssues(ticker, item.bars);
      nonPositive.push(...quality.nonPositive.map((row) => ({ ticker, ...row })));
      highLow.push(...quality.highLow.map((row) => ({ ticker, ...row })));
      duplicateDates.push(...quality.duplicateDates.map((date) => ({ ticker, date })));
      largeMoves.push(...findDailyMoveOutliers(ticker, item.bars));
      if (spyDates.length) gaps.push(...findSessionGaps(ticker, item.bars, spyDates));
    }

    // Post-checks: stored values equal the archive wherever it was accepted; no other stored bar changed or vanished.
    const readbackMismatches: any[] = [];
    let missingOriginalIds = 0, changedAsIntended = 0, unexpectedlyChanged = 0, afterCount = before.size;
    if (!DRY_RUN) {
      for (const row of perTicker.filter((entry) => entry.accepted)) {
        const stored = new Map((await storedBars(db, row.cik)).map((bar) => [bar.date, bar]));
        const mismatched = chosen.get(row.ticker)!.bars.filter((bar) => !stored.has(bar.date) || !sameBars(stored.get(bar.date)!, bar)).length;
        if (mismatched) readbackMismatches.push({ ticker: row.ticker, cik: row.cik, mismatchedBars: mismatched });
      }
      const ids = [...before.keys()];
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const slice = ids.slice(offset, offset + 1000);
        const [rows]: any = await db.execute(sql`SELECT id, cik, ticker, DATE_FORMAT(date,'%Y-%m-%d') AS d, open, high, low, close, adjClose, volume FROM prices WHERE id IN (${sql.join(slice.map((id) => sql`${id}`), sql`, `)})`);
        const after = new Map<number, string>(rows.map((row: any) => [Number(row.id), `${sha256(JSON.stringify([row.ticker, row.open, row.high, row.low, row.close, row.adjClose, row.volume])).slice(0, 16)}|${row.cik}|${row.d}`]));
        for (const id of slice) {
          const was = before.get(id)!;
          const now = after.get(id);
          if (now === undefined) missingOriginalIds++;
          else if (now !== was) {
            if (intended.has(was.slice(17))) changedAsIntended++;
            else unexpectedlyChanged++;
          }
        }
      }
      const [countRows]: any = await db.execute(sql`SELECT COUNT(*) AS rowsTotal FROM prices WHERE source="stooq"`);
      afterCount = Number(countRows[0].rowsTotal);
    }

    const byKind = (kind: string) => [...comparisons].filter(([, value]) => value.kind === kind).map(([ticker, value]) => ({ ticker, pattern: value.pattern, newDatesAppended: value.newDatesAppended, acceptedByOwner: value.accepted ?? false, medianRatio: value.factor, earliestRatio: value.earliestRatio, largestStep: value.largestStep, differingBars: value.differing, firstDiffering: value.firstDiffering, lastDiffering: value.lastDiffering, closeViolations: value.closeViolations, newDates: value.newDates }));
    const held = perTicker.filter((row) => !row.accepted).map((row) => row.ticker);
    const [missingGics]: any = await db.execute(sql`SELECT cik, ticker FROM companies WHERE sector IS NULL OR sector = "" ORDER BY ticker`);
    const unmatched = [...requestedTickers].filter((ticker) => !chosen.has(ticker)).map((ticker) => ({ ticker, reason: candidates.has(ticker) ? "Matching file holds no usable bars" : "No matching entry in the archive" }));
    const sp500Unique = new Set(edgar.map((row) => row.ticker));
    const sp500Matched = [...sp500Unique].filter((ticker) => chosen.has(ticker)).length;
    const summary = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      loadStartedAt: startedAt,
      mode: { refresh: REFRESH, dryRun: DRY_RUN, acceptedByOwner: [...ACCEPT].sort() },
      archive: identity,
      keyConvention: "SPY keeps cik=0; sector ETFs use -1001 through -1011. Second listings GOOG/FOX/NWS use -2001/-2002/-2003 because the bar key is (cik,date,source); primary listings retain the shared SEC CIK. Negative keys are local price-series identifiers, not SEC CIKs, and require no schema change",
      adjustmentPolicy: "Stooq bars are adjusted for splits and dividends as of the archive date, and a newer archive may also carry dividend adjustments an older one lacked. With --refresh a stored series is replaced by the archive when the stored closes differ from it by one factor (a split or dividend after the stored archive's date), by dividend steps (archive price never above the stored one, the ratio only rising towards the present, no one-day step above 15%), or not at all (corrected: open/high/low/volume only). Any other difference is held: the series keeps its stored bars and receives no new dates until reviewed. Stored dates missing from the archive are kept, never deleted",
      requested: requestedTickers.size,
      matched: chosen.size,
      unmatched,
      duplicates,
      sp500: { requested: sp500Unique.size, matched: sp500Matched, share: sp500Unique.size ? sp500Matched / sp500Unique.size : 0 },
      classes: Object.fromEntries(["new", "identical", "readjusted", "corrected", "revised"].map((kind) => [kind, byKind(kind).length])),
      readjusted: byKind("readjusted"),
      corrected: byKind("corrected"),
      held: byKind("revised"),
      storedOnlyDates: [...comparisons].filter(([, value]) => value.storedOnlyDates.length).map(([ticker, value]) => ({ ticker, count: value.storedOnlyDates.length, first: value.storedOnlyDates.slice(0, 10) })),
      rowsInserted,
      rowsUpdated,
      totalRows: afterCount,
      existingBars: { before: before.size, after: afterCount, missingOriginalIds, changedAsIntended, unexpectedlyChanged },
      readback: { verifiedTickers: perTicker.filter((row) => row.accepted).length - readbackMismatches.length, mismatches: readbackMismatches },
      perTicker,
      quality: { gaps, nonPositive, highLow, duplicateDates, largeMoves: largeMoves.map((row) => ({ ...row, reviewOnly: true })), companiesWithoutGics: missingGics },
      productionWrite: false,
      productionPushGuard: "prod-push builds pricesDaily from Schwab only, so these stooq rows cannot enter that lane; Stooq and Schwab remain separate by (cik,date,source)",
      knownLimits: [
        "The archive contains only tickers listed today, so the history describes survivors",
        "SPY and some tickers start on 2005-02-25 in this archive",
        `Bars after ${archiveLastDate || "the archive date"} need a newer archive or the Schwab daily bars`,
      ],
    };
    const output = argValue("--summary") ?? (DRY_RUN ? `worker/.runs/local-generated/price-load-stooq-${archiveLastDate}.dry-run.json` : DIR ? `research/engine/price-load-stooq-${archiveLastDate}.summary.json` : "research/engine/price-load-stooq-2026-10-27.summary.json");
    writeJsonAtomic(output, summary, true);
    console.log(JSON.stringify({ output, mode: summary.mode, archiveLastDate, requested: summary.requested, matched: summary.matched, unmatched: unmatched.length, duplicates: duplicates.length, sp500Share: summary.sp500.share, classes: summary.classes, held, rowsInserted, rowsUpdated, existingBars: summary.existingBars, readbackMismatches: readbackMismatches.length, storedOnlySeries: summary.storedOnlyDates.length, quality: { gaps: gaps.length, nonPositive: nonPositive.length, highLow: highLow.length, duplicateDates: duplicateDates.length, largeMoves: largeMoves.length, missingGics: missingGics.length } }, null, 2));
    const differing = !REFRESH && perTicker.some((row) => !row.accepted);
    if (!DRY_RUN && (readbackMismatches.length || missingOriginalIds || unexpectedlyChanged || differing || summary.sp500.share < 0.98 || !chosen.has("SPY") || SECTOR_ETF_TICKERS.some((ticker) => !chosen.has(ticker)))) throw new Error("Stooq load post-checks failed; inspect the summary");
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("load-stooq-prices.mts")) await main();
