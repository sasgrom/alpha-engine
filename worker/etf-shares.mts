/**
 * ETF share counts, hourly (owner's volume-flows plan, 2026-11-28). Run: npx tsx worker/etf-shares.mts [--root <dir>]
 *
 * One batched Schwab quote request (fields quote, fundamental, reference, regular) for the funds in worker/lib/etf-flows.ts.
 * Shares outstanding change when the fund creates or cancels shares, so consecutive counts give real money flows.
 * Hourly captures around the clock show when each fund's count changes, which settles the trading day a count
 * belongs to. Market data only; the token never leaves schwab-paced.
 *
 * Output on D: (never deleted):
 *   <root>/<UTC date>/<HHMM>Z.raw.json   the provider's answer as received
 *   <root>/shares.jsonl                  one compact row per fund and capture (append only)
 *   <root>/manifest.jsonl                one line per capture with the raw file's SHA-256 and the funds missing
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ETF_FUNDS, etfShareRow } from "./lib/etf-flows";
import { createSchwabSession } from "./lib/schwab-paced";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg("--root") ?? "D:/research/alpha-engine/etf-shares");
if (process.platform === "win32" && !/^d:/i.test(ROOT)) throw new Error("The ETF share archive must stay on the D: drive");
mkdirSync(ROOT, { recursive: true });
if (process.platform === "win32" && !/^d:/i.test(realpathSync(ROOT))) throw new Error("The ETF share archive must resolve to D:");
const log = (line: string) => console.log(`[etf-shares ${new Date().toISOString().slice(11, 19)}] ${line}`);

const session = createSchwabSession({ log });
await session.prepare();
const capturedAt = new Date().toISOString();
const symbols = ETF_FUNDS.map((fund) => fund.ticker);
const body = await session.get(`quotes?symbols=${encodeURIComponent(symbols.join(","))}&fields=quote,fundamental,reference,regular`);
const parsed = JSON.parse(body);
const dir = path.join(ROOT, capturedAt.slice(0, 10));
mkdirSync(dir, { recursive: true });
const rawFile = path.join(dir, `${capturedAt.slice(11, 13)}${capturedAt.slice(14, 16)}Z.raw.json`);
const tmp = `${rawFile}.${process.pid}.tmp`;
writeFileSync(tmp, body);
renameSync(tmp, rawFile);

const rows = symbols.filter((ticker) => parsed[ticker]).map((ticker) => etfShareRow(ticker, parsed[ticker], capturedAt));
const missing = symbols.filter((ticker) => !parsed[ticker] || etfShareRow(ticker, parsed[ticker], capturedAt).sharesOutstanding === null);
appendFileSync(path.join(ROOT, "shares.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
appendFileSync(path.join(ROOT, "manifest.jsonl"), JSON.stringify({
  capturedAt, file: path.relative(ROOT, rawFile).replace(/\\/g, "/"), sha256: createHash("sha256").update(body).digest("hex"),
  funds: symbols.length, rows: rows.length, missing,
}) + "\n");
log(`${rows.length}/${symbols.length} funds captured${missing.length ? `; no share count for ${missing.join(", ")}` : ""}`);
// A fund without a count is recorded, not fatal (collector skip rule); an empty answer fails the job so it shows.
if (!rows.length) throw new Error("Schwab returned no ETF quotes");
