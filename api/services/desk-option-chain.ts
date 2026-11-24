/**
 * A company's latest option chain for the desk, read from the raw Schwab archive on request: the newest complete
 * capture the collector's manifest names for the ticker, normalized by the collector's own reader and checked
 * against the manifest's hash. Read only: the manifest and the chain file, nothing else of that folder.
 *
 * The archive is on the external drive. When it cannot be read the page is told so; an unreadable archive is never
 * an empty chain. The last few chains stay in memory while their capture is the manifest's newest.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DeskOptionChain, DeskOptionQuote, DeskOptionStrike } from "@contracts/desk-option-chain";
import { schwabTokenDirectory } from "../../worker/lib/schwab";
import type { SchwabManifest, SchwabManifestEntry } from "../../worker/lib/schwab-market-data";
import { normalizeSchwabChain, type SchwabOptionRow } from "../../worker/lib/schwab-normalize";

const MAX_CACHED = 4;
const chains = new Map<string, { rows: SchwabOptionRow[]; delayed: boolean }>();
let manifestCache: { file: string; mtimeMs: number; size: number; latest: Map<string, SchwabManifestEntry> } | null = null;

function latestEntries(root: string): Map<string, SchwabManifestEntry> {
  const file = path.join(root, "manifest.json");
  if (!existsSync(file)) throw new Error("The option archive cannot be read (its manifest is not there). Is the data drive connected?");
  const { mtimeMs, size } = statSync(file);
  if (manifestCache && manifestCache.file === file && manifestCache.mtimeMs === mtimeMs && manifestCache.size === size) return manifestCache.latest;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as SchwabManifest;
  const latest = new Map<string, SchwabManifestEntry>();
  for (const entry of manifest.tickers) {
    if (entry.status !== "complete") continue;
    const held = latest.get(entry.ticker);
    if (!held || entry.capturedAt > held.capturedAt) latest.set(entry.ticker, entry);
  }
  manifestCache = { file, mtimeMs, size, latest };
  return latest;
}

const quote = (row: SchwabOptionRow): DeskOptionQuote => ({
  bid: row.bid, ask: row.ask, last: row.last, volume: row.volume, openInterest: row.openInterest,
  iv: row.iv !== null && row.iv > 0 && row.iv <= 5 ? row.iv : null, delta: row.delta,
});

/** `root` is the collector's archive folder; null when the manifest names no complete capture for the ticker. */
export function readDeskOptionChain(params: { ticker: string; expiration?: string }, root: string = schwabTokenDirectory()): DeskOptionChain | null {
  const entry = latestEntries(root).get(params.ticker);
  if (!entry) return null;
  // the manifest's file is a relative path inside the archive: never followed outside it
  const file = path.resolve(root, entry.file);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error("The manifest names a file outside the option archive");
  const key = `${file}|${entry.capturedAt}`;
  let chain = chains.get(key);
  if (chain) chains.delete(key);
  else {
    if (!existsSync(file)) throw new Error("The option archive cannot be read (the chain file is not there). Is the data drive connected?");
    const normalized = normalizeSchwabChain(readFileSync(file, "utf8"), entry.capturedAt);
    if (normalized.sourceHash !== entry.sourceHash) throw new Error("The chain file does not match the hash the collector recorded");
    if (normalized.sourceStatus !== "SUCCESS" || normalized.chainTruncated) throw new Error("The provider marked this chain as incomplete");
    chain = { rows: normalized.rows, delayed: normalized.delayed };
  }
  chains.set(key, chain);
  while (chains.size > MAX_CACHED) chains.delete(chains.keys().next().value as string);

  const counts = new Map<string, { dte: number; contracts: number }>();
  for (const row of chain.rows) {
    const held = counts.get(row.expiration) ?? { dte: row.dte, contracts: 0 };
    held.contracts++;
    counts.set(row.expiration, held);
  }
  const expirations = [...counts].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date));
  if (!expirations.length) return null;
  const expiration = (params.expiration && counts.has(params.expiration) ? params.expiration : null) ?? (expirations.find((item) => item.dte >= 7) ?? expirations[0]).date;
  const byStrike = new Map<number, DeskOptionStrike>();
  for (const row of chain.rows) {
    if (row.expiration !== expiration) continue;
    const held = byStrike.get(row.strike) ?? { strike: row.strike, call: null, put: null };
    if (row.putCall === "CALL") held.call = quote(row);
    else held.put = quote(row);
    byStrike.set(row.strike, held);
  }
  return {
    ticker: params.ticker, capturedAt: entry.capturedAt, underlyingPrice: chain.rows[0]?.underlyingPrice ?? null, delayed: chain.delayed,
    expirations, expiration, strikes: [...byStrike.values()].sort((a, b) => a.strike - b.strike),
  };
}
