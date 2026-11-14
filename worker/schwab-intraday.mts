/**
 * Intraday prices every five minutes of a trading session (scheduler job schwab-intraday): renews the Schwab token,
 * takes one batched quote snapshot of every price series (S&P 500 with both listings of dual-class companies, the
 * research companies, SPY and the sector funds), and writes under D:\research\alpha-engine\schwab-intraday:
 *   <session>/<HHMM>.json       compact quotes (HHMM US Eastern),
 *   <session>/<HHMM>.raw.json   responses only at 00/20/40 past the hour; existing raw files are left untouched,
 *   <session>/bars.json         five-minute bars of the session so far, with approximate highs and lows,
 *   live.json                   the live prices the desk snapshot reads,
 *   manifest.jsonl              one line per snapshot with its SHA-256 and whether raw was retained.
 * Sessions accumulate on D:; the desk reads at most five and nothing is pruned. Market data only: no account, order or
 * production request, and nothing is written to the daily price history. A holiday, or a time outside the regular
 * session, ends the run without a snapshot. A failed batch fails the run: the previous live prices stay in place.
 *
 *   npx tsx worker/schwab-intraday.mts [--root D:/...]
 *   --ignore-hours (verification only, with a separate --root): takes a snapshot outside the session as well
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./lib/json-file";
import { parseMarketHours, schwabMarketHoursPath } from "./lib/schwab-context";
import { buildBars, livePrices, parseQuotes, rawSnapshotDue, sessionWindow, symbolBatches, type IntradayQuote, type IntradaySnapshot } from "./lib/schwab-intraday";
import { createSchwabSession } from "./lib/schwab-paced";
import { schwabPriceSeries } from "./lib/schwab-price-series";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const DEFAULT_ROOT = path.resolve("D:/research/alpha-engine/schwab-intraday");
const ROOT = path.resolve(arg("--root") ?? DEFAULT_ROOT);
const ignoreHours = process.argv.includes("--ignore-hours");
if (process.platform === "win32" && !/^d:/i.test(ROOT)) throw new Error("The intraday archive must stay on the D: drive");
if (ignoreHours && ROOT === DEFAULT_ROOT) throw new Error("--ignore-hours is for verification: give a separate --root, so the desk's live prices stay untouched");
mkdirSync(ROOT, { recursive: true });
if (process.platform === "win32" && !/^d:/i.test(realpathSync(ROOT))) throw new Error("The intraday archive must resolve to D:");
const log = (line: string) => console.log(`[schwab-intraday ${new Date().toISOString().slice(11, 19)}] ${line}`);

const session = createSchwabSession({ log });
await session.prepare(); // renews the access token when it is near its end, so the token stays fresh all session
const capturedAt = new Date();
const hours = parseMarketHours(await session.get(schwabMarketHoursPath("equity")), capturedAt.toISOString());
const window = sessionWindow(hours, capturedAt);
if (!window.open && !ignoreHours) {
  log(`token checked; no snapshot: ${window.reason}`);
  process.exit(0);
}

const symbols = [...new Set(schwabPriceSeries().map((series) => series.schwabSymbol))].sort();
const raw: unknown[] = [];
const quotes: Record<string, IntradayQuote> = {};
for (const batch of symbolBatches(symbols)) {
  const body = await session.get(`quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote,regular`);
  const parsed = JSON.parse(body);
  raw.push(parsed);
  for (const [symbol, quote] of parseQuotes(parsed)) quotes[symbol] = quote;
}
const missing = symbols.filter((symbol) => !quotes[symbol]);

const easternTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(capturedAt);
const hhmm = `${easternTime.find((part) => part.type === "hour")!.value}${easternTime.find((part) => part.type === "minute")!.value}`;
const folder = path.join(ROOT, hours.date);
mkdirSync(folder, { recursive: true });
const rawRetained = rawSnapshotDue(capturedAt.toISOString());
const rawSha256 = rawRetained ? createHash("sha256").update(JSON.stringify(raw)).digest("hex") : null;
const snapshot: IntradaySnapshot = { schemaVersion: 1, session: hours.date, capturedAt: capturedAt.toISOString(), quotes };
if (rawRetained) writeJsonAtomic(path.join(folder, `${hhmm}.raw.json`), raw);
writeJsonAtomic(path.join(folder, `${hhmm}.json`), snapshot);

// the session's five-minute bars, from every snapshot of the session so far
const snapshots = readdirSync(folder).filter((name) => /^\d{4}\.json$/.test(name)).sort().map((name) => JSON.parse(readFileSync(path.join(folder, name), "utf8")) as IntradaySnapshot);
writeJsonAtomic(path.join(folder, "bars.json"), { schemaVersion: 1, session: hours.date, intervalMinutes: 5, snapshots: snapshots.length, updatedAt: capturedAt.toISOString(), bars: buildBars(snapshots) });
const live = livePrices(snapshot);
writeJsonAtomic(path.join(ROOT, "live.json"), live);
appendFileSync(path.join(ROOT, "manifest.jsonl"), `${JSON.stringify({ session: hours.date, file: `${hours.date}/${hhmm}.json`, capturedAt: snapshot.capturedAt, asOf: live.asOf, quotes: Object.keys(quotes).length, missing, rawRetained, rawSha256 })}\n`);

log(`session ${hours.date} ${hhmm} ET: ${Object.keys(quotes).length}/${symbols.length} quotes as of ${live.asOf}, ${snapshots.length} snapshots today${missing.length ? `; no price for ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}` : ""}`);
process.exit(0);
