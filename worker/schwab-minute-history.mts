/**
 * Weekly save of Schwab's rolling intraday history (owner's volume-flows plan, 2026-11-28).
 * Run: npx tsx worker/schwab-minute-history.mts [--date YYYY-MM-DD] [--root <dir>] [--only TICKER]
 *
 * Schwab keeps 1-minute bars for about 34 sessions and 5-minute bars for about 180 (measured 2026-11-28), so the
 * buy/sell split from minute bars only gets a history if the window is saved before it rolls off. One request per
 * symbol and bar size, 1 s apart, for every daily price series plus the ETF funds of worker/lib/etf-flows.ts.
 * Regular session only. Market data only.
 *
 * Output on D: (never deleted): <root>/<date>/{1m,5m}/<SYMBOL>.json as received, manifest.jsonl (candles, first and
 * last bar, SHA-256), todo.json (symbols that failed three attempts; the run moves on). Rerunning the same date
 * resumes: files already written are kept.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, realpathSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ETF_FUNDS } from "./lib/etf-flows";
import { createSchwabSession } from "./lib/schwab-paced";
import { schwabPriceSeries, schwabSymbol } from "./lib/schwab-price-series";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const day = arg("--date") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Bad --date ${day}`);
const BASE = path.resolve(arg("--root") ?? "D:/research/alpha-engine/schwab-minute");
const ROOT = path.join(BASE, day);
if (process.platform === "win32" && !/^d:/i.test(BASE)) throw new Error("The minute archive must stay on the D: drive");
mkdirSync(ROOT, { recursive: true });
if (process.platform === "win32" && !/^d:/i.test(realpathSync(ROOT))) throw new Error("The minute archive must resolve to D:");
const free = statfsSync(ROOT);
if (free.bavail * free.bsize < 5 * 1024 ** 3) throw new Error("Less than 5 GiB free on the minute archive drive");
const log = (line: string) => console.log(`[schwab-minute ${new Date().toISOString().slice(11, 19)}] ${line}`);

const only = arg("--only")?.toUpperCase() ?? null;
const series = new Map<string, string>();
for (const s of schwabPriceSeries()) series.set(s.ticker, s.schwabSymbol);
for (const fund of ETF_FUNDS) if (!series.has(fund.ticker)) series.set(fund.ticker, schwabSymbol(fund.ticker));
const symbols = [...series.entries()].filter(([ticker]) => !only || ticker === only).sort(([a], [b]) => a.localeCompare(b));
if (only && !symbols.length) throw new Error(`Unknown ticker ${only}`);

const session = createSchwabSession({ log, minIntervalMs: 1000 });
await session.prepare();
const START = Date.parse(`${Number(day.slice(0, 4)) - 1}-01-01T00:00:00Z`), END = Date.parse(`${day}T23:59:59Z`);
const todo: { ticker: string; freq: number; error: string }[] = [];
let written = 0, kept = 0;
log(`${symbols.length} symbols → ${ROOT}`);
for (const freq of [1, 5]) {
  const dir = path.join(ROOT, `${freq}m`);
  mkdirSync(dir, { recursive: true });
  for (const [ticker, symbol] of symbols) {
    const file = path.join(dir, `${ticker.replace(/[^A-Za-z0-9.-]/g, "_")}.json`);
    if (existsSync(file)) { kept++; continue; }
    const request = `pricehistory?symbol=${encodeURIComponent(symbol)}&frequencyType=minute&frequency=${freq}&startDate=${START}&endDate=${END}&needExtendedHoursData=false`;
    let error = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = await session.get(request);
        const candles = (JSON.parse(body).candles ?? []) as { datetime: number }[];
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, file);
        appendFileSync(path.join(ROOT, "manifest.jsonl"), JSON.stringify({
          ticker, symbol, freq, candles: candles.length,
          first: candles.length ? new Date(candles[0].datetime).toISOString() : null,
          last: candles.length ? new Date(candles[candles.length - 1].datetime).toISOString() : null,
          bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"), capturedAt: new Date().toISOString(),
        }) + "\n");
        written++;
        error = "";
        break;
      } catch (e) {
        error = String((e as Error)?.message ?? e).slice(0, 200);
      }
    }
    if (error) { todo.push({ ticker, freq, error }); log(`${ticker} ${freq}m skipped after 3 attempts: ${error}`); }
    if ((written + kept) % 200 === 0) log(`progress ${written + kept}/${symbols.length * 2}`);
  }
}
writeFileSync(path.join(ROOT, "todo.json"), JSON.stringify(todo, null, 1));
log(`done: ${written} written, ${kept} kept from an earlier run, ${todo.length} in todo.json`);
if (written + kept === 0) throw new Error("No minute history saved");
