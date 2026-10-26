/**
 * Free options snapshot collector. Raw provider payloads are immutable cache
 * files; normalized chains are derived artifacts. Existing files skip network
 * unless --force is supplied. Demo sources remain explicitly marked as demos.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEdgarUniverse } from "./lib/edgar";
import { normalizeAlphaVantage, normalizeCboe, normalizeEodhd, type OptionChainSnapshot } from "./lib/options";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const SOURCE = arg("--source") ?? "all";
const ONLY = arg("--only")?.toUpperCase() ?? null;
const FORCE = process.argv.includes("--force");
const ALPHA_DATE = arg("--date") ?? "2017-11-15";
const SNAPSHOT_ID = arg("--snapshot-id") ?? new Date().toISOString().replaceAll(":", "-");
const RPS = Math.min(Math.max(Number(process.env.OPTIONS_RPS ?? 2) || 2, 0.5), 5);
const ROOT = path.resolve(import.meta.dirname, "cache", "options");
const NORMALIZED = path.resolve(import.meta.dirname, "cache", "options-normalized");
const MANIFEST = path.join(ROOT, "manifest.json");
const prog = startProgress("options", `source=${SOURCE}, rps=${RPS}, snapshot=${SNAPSHOT_ID}`);

function atomicText(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
function atomicJson(file: string, value: unknown) { atomicText(file, JSON.stringify(value)); }
function readManifest(): any[] { try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return []; } }
const manifest = readManifest();

let nextAllowed = 0;
async function throttle() {
  const wait = Math.max(0, nextAllowed - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  nextAllowed = Math.max(Date.now(), nextAllowed) + 1000 / RPS;
}

class HttpError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`HTTP ${status} ${url}${body ? ` — ${body.slice(0, 240)}` : ""}`);
    this.name = "HttpError";
  }
}

async function fetchText(url: string): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "user-agent": "alpha-engine-research/1.0" }, signal: AbortSignal.timeout(45_000) });
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new HttpError(res.status, url, await res.text());
    } catch (err) {
      last = err;
      if (err instanceof HttpError && err.status !== 429) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw last;
}

async function fetchJson(url: string): Promise<any> { return JSON.parse(await fetchText(url)); }
function withDemoToken(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("api_token")) u.searchParams.set("api_token", "demo");
  return u.toString();
}
function record(snapshot: OptionChainSnapshot) {
  const key = `${snapshot.provider}|${snapshot.underlying}|${snapshot.tradeDate}`;
  const index = manifest.findIndex((m) => `${m.provider}|${m.underlying}|${m.tradeDate}` === key && (m.snapshotId ?? null) === (snapshot.snapshotId ?? null));
  const row = {
    provider: snapshot.provider, underlying: snapshot.underlying, tradeDate: snapshot.tradeDate,
    snapshotId: snapshot.snapshotId ?? null,
    availableAt: snapshot.availableAt, ingestedAt: snapshot.ingestedAt, quality: snapshot.quality, warnings: snapshot.warnings,
  };
  if (index >= 0) manifest[index] = row;
  else manifest.push(row);
  atomicJson(MANIFEST, manifest);
}

async function cboe(ticker: string, date: string, snapshotId: string) {
  const rawPath = path.join(ROOT, "cboe", date, snapshotId, `${ticker}.json`);
  let payload: any;
  if (existsSync(rawPath) && !FORCE) payload = JSON.parse(readFileSync(rawPath, "utf8"));
  else {
    const text = await fetchText(`https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json`);
    atomicText(rawPath, text);
    payload = JSON.parse(text);
  }
  const snapshot = normalizeCboe(payload, new Date().toISOString());
  snapshot.snapshotId = snapshotId;
  atomicJson(path.join(NORMALIZED, "cboe", snapshot.tradeDate, snapshotId, `${ticker}.json`), snapshot);
  record(snapshot);
  prog.log(`${ticker}: ${snapshot.quality.contracts} contracts · ${snapshot.quality.expirations} expirations · dupes ${snapshot.quality.duplicates} · invalid ${snapshot.quality.invalidRows} · crossed ${snapshot.quality.crossedQuotes}`);
}

async function eodhd() {
  const rows: any[] = [];
  const warnings: string[] = [];
  let next: string | null = "https://eodhd.com/api/mp/unicornbay/options/eod?filter[underlying_symbol]=AAPL&page[limit]=1000&api_token=demo";
  for (let page = 1; next && page <= 25; page++) {
    const rawPath = path.join(ROOT, "eodhd", SNAPSHOT_ID, `AAPL-eod-page-${String(page).padStart(4, "0")}.json`);
    let payload: any;
    if (existsSync(rawPath) && !FORCE) payload = JSON.parse(readFileSync(rawPath, "utf8"));
    else {
      try {
        const text = await fetchText(withDemoToken(next));
        atomicText(rawPath, text);
        payload = JSON.parse(text);
      } catch (err) {
        if (err instanceof HttpError && err.status === 422 && rows.length > 0) {
          warnings.push(`Pagination stopped at HTTP 422 on page ${page}; coverage may be incomplete.`);
          break;
        }
        throw err;
      }
    }
    rows.push(...(payload.data ?? []));
    next = payload.links?.next ? withDemoToken(payload.links.next) : null;
  }
  const snapshots = normalizeEodhd({ data: rows }, new Date().toISOString());
  for (const snapshot of snapshots) {
    snapshot.snapshotId = SNAPSHOT_ID;
    snapshot.warnings = warnings;
    atomicJson(path.join(NORMALIZED, "eodhd", snapshot.tradeDate, SNAPSHOT_ID, "AAPL.json"), snapshot);
    record(snapshot);
  }
  const duplicates = snapshots.reduce((a, s) => a + s.quality.duplicates, 0);
  const invalid = snapshots.reduce((a, s) => a + s.quality.invalidRows, 0);
  prog.log(`AAPL EODHD: ${rows.length} rows · ${snapshots.length} daily chains · dupes ${duplicates} · invalid ${invalid}${warnings.length ? ` · WARNING ${warnings.join(" | ")}` : ""}`);
}

async function alphaVantage() {
  const rawPath = path.join(ROOT, "alphavantage", ALPHA_DATE, "IBM.json");
  let payload: any;
  if (existsSync(rawPath) && !FORCE) payload = JSON.parse(readFileSync(rawPath, "utf8"));
  else {
    const text = await fetchText(`https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol=IBM&date=${ALPHA_DATE}&apikey=demo`);
    atomicText(rawPath, text);
    payload = JSON.parse(text);
  }
  const snapshot = normalizeAlphaVantage(payload, new Date().toISOString());
  atomicJson(path.join(NORMALIZED, "alphavantage", snapshot.tradeDate, "IBM.json"), snapshot);
  record(snapshot);
  prog.log(`IBM ${ALPHA_DATE}: ${snapshot.quality.contracts} contracts · ${snapshot.quality.expirations} expirations · dupes ${snapshot.quality.duplicates} · invalid ${snapshot.quality.invalidRows}`);
}

if (SOURCE === "cboe" || SOURCE === "all") {
  const universe = loadEdgarUniverse("edgar-universe-35.json").filter((c) => !ONLY || c.ticker === ONLY);
  const date = arg("--snapshot-date") ?? new Date().toISOString().slice(0, 10);
  for (const co of universe) {
    try { await cboe(co.ticker, date, SNAPSHOT_ID); }
    catch (err) { prog.log(`! ${co.ticker}: ${String(err).slice(0, 180)}`); }
  }
}
if ((SOURCE === "eodhd" || SOURCE === "all") && (!ONLY || ONLY === "AAPL")) {
  try { await eodhd(); } catch (err) { prog.log(`! EODHD: ${String(err).slice(0, 180)}`); }
}
if ((SOURCE === "alphavantage" || SOURCE === "all") && (!ONLY || ONLY === "IBM")) {
  try { await alphaVantage(); } catch (err) { prog.log(`! Alpha Vantage: ${String(err).slice(0, 180)}`); }
}
prog.done(`options snapshots complete: ${manifest.length} tracked chains`);
process.exit(0);
