import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { LivePrices, IntradaySnapshot } from "./schwab-intraday";
import type { PriceAdjustment, StoredIntradaySession } from "./intraday-views";

const jsonCache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();
const textCache = new Map<string, { mtimeMs: number; size: number; value: string }>();

export function readIntradayJsonFile<T>(file: string): T {
  const stat = statSync(file), cached = jsonCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value as T;
  const value = JSON.parse(readFileSync(file, "utf8")) as T;
  jsonCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

function readTextCached(file: string): string {
  const stat = statSync(file), cached = textCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
  const value = readFileSync(file, "utf8");
  textCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

export function defaultIntradayRoot(): string {
  const root = path.resolve("D:/research/alpha-engine/schwab-intraday");
  if (!existsSync(root)) throw new Error("The intraday archive is not readable");
  const real = realpathSync(root);
  if (process.platform === "win32" && !/^d:/i.test(real)) throw new Error("The intraday archive must resolve to D:");
  return real;
}

export function listIntradaySessions(root: string): string[] {
  if (!existsSync(root)) throw new Error("The intraday archive is not readable");
  return readdirSync(root).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name) && existsSync(path.join(root, name, "bars.json"))).sort();
}

export function readStoredIntradaySession(root: string, session: string): StoredIntradaySession | null {
  const folder = path.join(root, session), barsFile = path.join(folder, "bars.json");
  if (!existsSync(barsFile)) return null;
  const stored = readIntradayJsonFile<{ session: string; updatedAt: string; bars: StoredIntradaySession["bars"] }>(barsFile);
  if (stored.session !== session || !stored.bars || typeof stored.bars !== "object") throw new Error("Invalid intraday bars");
  const snapshots = readdirSync(folder).filter(name => /^\d{4}\.json$/.test(name)).sort().map(name => readIntradayJsonFile<IntradaySnapshot>(path.join(folder, name)));
  const previousClose: StoredIntradaySession["previousClose"] = {}, delayed: StoredIntradaySession["delayed"] = {};
  for (const snapshot of snapshots) {
    for (const [ticker, quote] of Object.entries(snapshot.quotes)) {
      if (previousClose[ticker] === undefined || previousClose[ticker] === null) previousClose[ticker] = quote.previousClose;
      if (!(ticker in delayed)) delayed[ticker] = null;
      if (typeof quote.delayed === "boolean") delayed[ticker] = quote.delayed;
    }
  }
  return { session, updatedAt: stored.updatedAt, bars: stored.bars, previousClose, delayed };
}

export function readIntradayLive(root: string): LivePrices | null {
  const file = path.join(root, "live.json");
  return existsSync(file) ? readIntradayJsonFile<LivePrices>(file) : null;
}

export function readPriceAdjustments(file: string): PriceAdjustment[] {
  if (!existsSync(file)) return [];
  const seen = new Set<string>(), events: PriceAdjustment[] = [];
  for (const line of readTextCached(file).split(/\r?\n/).filter(line => line.trim())) {
    const row = JSON.parse(line);
    if (row.dryRun === true || typeof row.ticker !== "string" || !Number.isFinite(row.ratio) || row.ratio <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.firstNewBasisDate)) continue;
    const key = `${row.ticker}|${row.firstNewBasisDate}|${row.ratio}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ ticker: row.ticker, ratio: Number(row.ratio), firstNewBasisDate: row.firstNewBasisDate });
  }
  return events;
}

export interface ReleaseCalendarRow {
  cik: number;
  ticker: string;
  periodicForm: string;
  periodicAccession: string | null;
  periodicAcceptedEt: string | null;
  earningsAccession: string | null;
  earningsAcceptedEt: string | null;
  firstPublicationEt: string | null;
  earningsFilings?: { accessionNo: string; acceptedEt: string }[];
}

export function readReleaseCalendar(files: string[]): ReleaseCalendarRow[] {
  const rows: ReleaseCalendarRow[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readTextCached(file).split(/\r?\n/).filter(line => line.trim())) rows.push(JSON.parse(line) as ReleaseCalendarRow);
  }
  return rows;
}

export function clearIntradayCaches(): void {
  jsonCache.clear();
  textCache.clear();
}
