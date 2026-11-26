/**
 * Stage 1.7 bulk import (iteration 3g) — TEMPORARY CRUTCH, marked TODO.
 *
 * Why this exists: the cloud runtime cannot reach stooq.com / Yahoo at all
 * (UND_ERR_CONNECT_TIMEOUT from production), so live per-ticker fetching is
 * impossible for now. The job reads Stooq's stored bulk daily archive
 * (d_us_txt.zip, ~516 MB) from object storage, stream-unzips it
 * and imports ONLY the companies currently in our universe (+ the SPY
 * benchmark). Everything else in the archive is deliberately ignored.
 *
 * TODO (documented in MANUAL §4.10): when storage is no longer constrained,
 * re-upload a fresh archive and import FULL history for every US ticker —
 * the import pipeline already supports it, the universe filter is just a
 * set membership check. The uploaded zip parts stay in object storage under
 * prices-import/<batch>/ as the sample archive.
 *
 * The runner lists the existing object-storage parts in sequential order and
 * streams them through one unzipper.Parse instance, without materializing the
 * whole archive in memory.
 *
 * Archive layout (Stooq "preferred folders structure"):
 *   data/daily/us/{nasdaq stocks,nyse stocks,...}/{1,2,3}/aapl.us.txt
 * Each file is Metastock-style CSV:
 *   <TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>
 *   AAPL.US,D,20261009,000000,250.1,251.0,249.5,250.5,12345678,0
 */
import { PassThrough, Readable } from "node:stream";
import * as unzipper from "unzipper";
import { getDb } from "../queries/connection";
import { userUniverse } from "@db/schema";
import { eq } from "drizzle-orm";
import { storage } from "../lib/storage";
import { upsertBars, type PriceBar } from "./prices";

export const IMPORT_PREFIX = "prices-import";

// ---------------------------------------------------------------------------
// Metastock daily CSV parsing
// ---------------------------------------------------------------------------
/**
 * Parse one archive file into PriceBars. Dates come as YYYYMMDD, the header
 * row is skipped, rows with a non-numeric close are dropped (halted days in
 * Stooq ASCII carry 0/empty fields). adjClose = close: Stooq daily series
 * is already split/dividend-adjusted, same contract as the per-ticker API.
 */
export function parseMetastockDaily(text: string): PriceBar[] {
  const lines = text.split("\n");
  const bars: PriceBar[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("<TICKER>")) continue;
    const p = line.split(",");
    if (p.length < 9) continue;
    const d = p[2]; // YYYYMMDD
    if (!/^\d{8}$/.test(d)) continue;
    // empty string must be null — Number("") is 0, which would silently
    // turn halted-day rows (empty close) into zero-price bars
    const num = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };
    const close = num(p[7]);
    if (close === null) continue;
    const vol = num(p[8]);
    bars.push({
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      open: num(p[4]),
      high: num(p[5]),
      low: num(p[6]),
      close,
      adjClose: close,
      volume: vol !== null ? Math.round(vol) : null,
    });
  }
  return bars;
}

/**
 * Map an archive entry path to our ticker, or null when not wanted.
 * Matching is on the basename ("aapl.us.txt" → "AAPL"); class shares in our
 * universe use "." while Stooq filenames use "-" (BRK.B → brk-b.us.txt).
 */
export function entryToTicker(entryPath: string, wanted: Set<string>): string | null {
  const base = entryPath.split("/").pop()?.toLowerCase() ?? "";
  if (!base.endsWith(".us.txt")) return null;
  const sym = base.slice(0, -".us.txt".length).toUpperCase();
  if (wanted.has(sym)) return sym;
  // try the dot↔dash class-share spelling
  const dotted = sym.replace(/-/g, ".");
  if (wanted.has(dotted)) return dotted;
  return null;
}

export function archiveTargets(sourceTicker: string, wanted: Map<string, number>, aliases: Record<string, string[]> = {}): string[] {
  return [sourceTicker, ...(aliases[sourceTicker] ?? [])].filter((t) => wanted.has(t));
}

/** part-NNNN.bin key -> NNNN (null on any non-part key). Pure, tested. */
export function partIndexFromKey(key: string): number | null {
  const m = /\/part-(\d{4})-[0-9a-f]{8}\.bin$/.exec(key) ?? /\/part-(\d{4})\.bin$/.exec(key);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// the import job body (called from runner.ts)
// ---------------------------------------------------------------------------
export interface ImportReport {
  filesMatched: number;
  filesWanted: number;
  barsWritten: number;
  tickers: string[];
  missing: string[];
}

export interface PriceImportOverride {
  wanted?: Map<string, number>;
  /** One archive ticker may map to multiple evidence CIKs (XOM → XOM_PRE). */
  aliases?: Record<string, string[]>;
}

type Logger = (level: "info" | "warn" | "error", message: string) => Promise<void>;

/**
 * Stream-unzip the uploaded archive parts and import the wanted tickers.
 * `wanted` maps our ticker → cik; the SPY benchmark rides along as cik=0.
 * Streaming contract: parts are piped sequentially into ONE unzipper stream
 * (a zip is a sequential format — concatenated parts = the original file);
 * unwanted entries are autodrained, wanted entries are buffered per-file
 * (largest single-ticker history is ~0.5 MB — nothing to stream further).
 */
export async function importPricesFromStorage(
  batch: string,
  logger: Logger,
  onProgress?: (matched: number, bars: number, total: number) => Promise<void>,
  isCancelled?: () => boolean,
  override: PriceImportOverride = {},
): Promise<ImportReport> {
  const db = getDb();
  // Default: union of active memberships + SPY. Research imports pass an
  // explicit universe and optional archive-ticker aliases (XOM → XOM_PRE).
  let wanted: Map<string, number>;
  if (override.wanted) {
    wanted = override.wanted;
  } else {
    const rows = await db
      .selectDistinct({ cik: userUniverse.cik, ticker: userUniverse.ticker })
      .from(userUniverse)
      .where(eq(userUniverse.active, true))
      .limit(5000);
    wanted = new Map<string, number>(rows.map((r) => [r.ticker.toUpperCase(), r.cik]));
  }
  if (!wanted.has("SPY")) wanted.set("SPY", 0);
  const aliases = override.aliases ?? {};

  // archive parts, in upload order — listing the prefix doubles as the
  // "did all chunks actually persist" check
  const listing = await storage.listFiles({ prefix: `${IMPORT_PREFIX}/${batch}/`, delimiter: "" });
  const parts = listing.objects.map((o) => o.key).sort();
  if (parts.length === 0) throw new Error(`no parts found under ${IMPORT_PREFIX}/${batch}/`);
  await logger("info", `Import: ${parts.length} archive parts (${(listing.objects.reduce((s, o) => s + o.size, 0) / 1e6).toFixed(0)} MB), ${wanted.size} wanted tickers (universe + SPY)`);

  const report: ImportReport = { filesMatched: 0, filesWanted: wanted.size, barsWritten: 0, tickers: [], missing: [] };

  // one concatenated stream over all parts → one unzipper parser
  const combined = new PassThrough({ highWaterMark: 1 << 20 });
  const entries = combined.pipe(unzipper.Parse({ forceStream: true }));

  const feeder = (async () => {
    try {
      for (const key of parts) {
        const { url } = await storage.getPresignedUrl({ key });
        const resp = await fetch(url);
        if (!resp.ok || !resp.body) throw new Error(`part fetch failed: ${key} HTTP ${resp.status}`);
        const nodeStream = Readable.fromWeb(resp.body as import("stream/web").ReadableStream);
        await new Promise<void>((resolve, reject) => {
          nodeStream.on("error", reject);
          combined.on("error", reject);
          nodeStream.on("end", resolve);
          nodeStream.pipe(combined, { end: false });
        });
      }
      combined.end();
    } catch (err) {
      // a dead feeder must not leave the consumer hanging on the next entry:
      // destroy the combined stream so the unzip pipeline errors out
      combined.destroy(err as Error);
      throw err;
    }
  })();
  // if the consumer errors first, the feeder may still reject later — swallow
  // it here (the consumer's error is the one we report) to avoid an
  // unhandled rejection taking down the worker process
  feeder.catch(() => {});

  try {
    const sourceTickers = new Set([...wanted.keys(), ...Object.keys(aliases)]);
    for await (const entry of entries as AsyncIterable<{ path: string; autodrain: () => void } & Readable>) {
      if (isCancelled?.()) throw new Error("cancelled by user");
      const sourceTicker = entryToTicker(entry.path, sourceTickers);
      if (!sourceTicker) {
        entry.autodrain();
        continue;
      }
      const targets = archiveTargets(sourceTicker, wanted, aliases);
      if (targets.length === 0) {
        entry.autodrain();
        continue;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of entry) chunks.push(chunk as Buffer);
      const bars = parseMetastockDaily(Buffer.concat(chunks).toString("utf8"));
      for (const ticker of targets) {
        const cik = wanted.get(ticker)!;
        const written = await upsertBars(cik, ticker, bars, "stooq");
        report.filesMatched++;
        report.barsWritten += written;
        report.tickers.push(ticker);
        await logger("info", `${ticker} (cik ${cik}): ${bars.length} bars imported from archive${ticker === sourceTicker ? "" : ` via ${sourceTicker}`}`);
        await onProgress?.(report.filesMatched, report.barsWritten, report.filesWanted);
      }
    }
    await feeder; // surface feeder errors (part fetch failures)
  } catch (err) {
    combined.destroy();
    throw err;
  }

  report.missing = [...wanted.keys()].filter((t) => !report.tickers.includes(t));
  for (const t of report.missing) {
    await logger("warn", `${t}: no file in the archive (not in universe import — check spelling/delisting)`);
  }
  return report;
}
