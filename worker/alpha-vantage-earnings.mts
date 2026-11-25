/**
 * Alpha Vantage EARNINGS: analysts' consensus EPS per reported quarter for the registry companies (owner's go of
 * 2026-11-25). Research input only.
 *
 *   npx tsx worker/alpha-vantage-earnings.mts [--limit 25] [--dry-run] [--init]
 *
 * The key is read from ALPHAVANTAGE_API_KEY (.env, set by the owner) and is never printed, logged or stored: requests
 * are logged by ticker only, and an error never carries the URL. At most --limit requests a run (the free key allows 25
 * a day), one every 15 seconds (5 a minute). A rate-limit notice stops the run without marking anything; a notice that
 * refuses the request (premium only) stops it with an error.
 *
 * Archive: D:\research\alpha-engine\estimates\alphavantage\earnings, raw\<TICKER>\<date>.json as received (never
 * rewritten) and manifest.json (per ticker: CIK, the symbol that answered, each file's SHA-256, bytes, quarters, how many
 * carry an estimate, first and last quarter). --init creates the empty archive once; otherwise a missing archive (the
 * D: drive may be away) stops the run and nothing is created in its place.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { ALPHA_VANTAGE_URL, classifyAnswer, DAILY_LIMIT, pickTickers, SPACING_MS, symbolsFor, type Manifest } from "./lib/alpha-vantage-earnings";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/estimates/alphavantage/earnings");
const limit = Number(arg("--limit") ?? DAILY_LIMIT), dryRun = process.argv.includes("--dry-run");
if (!Number.isInteger(limit) || limit < 1 || limit > DAILY_LIMIT) throw new Error(`--limit must be 1 to ${DAILY_LIMIT}`);
const apiKey = process.env.ALPHAVANTAGE_API_KEY?.trim() ?? "";
if (!/^[A-Za-z0-9]{8,40}$/.test(apiKey)) throw new Error("ALPHAVANTAGE_API_KEY is not set to a plausible key in .env (the value is not shown)");

const raw = path.join(root, "raw"), manifestFile = path.join(root, "manifest.json");
if (process.argv.includes("--init") && !existsSync(manifestFile)) {
  if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("The archive must be on D:");
  mkdirSync(raw, { recursive: true });
  writeJsonAtomic(manifestFile, { schemaVersion: 1, source: `${ALPHA_VANTAGE_URL}?function=EARNINGS`, tickers: {}, runs: [] } satisfies Manifest, true);
}
if (!existsSync(raw) || !existsSync(manifestFile)) throw new Error(`The Alpha Vantage archive is not at ${root}; nothing was fetched or created (first run: --init)`);
if (!/^d:/i.test(realpathSync(raw)) && !arg("--root")) throw new Error("The Alpha Vantage archive must resolve to D:");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;

const client = getDb().$client.promise();
const [companies] = await client.query("SELECT cik, ticker FROM companies WHERE cik > 0 AND ticker IS NOT NULL AND ticker <> ''") as [Array<{ cik: number; ticker: string }>, unknown];
await client.end();
const registry = companies.map(row => ({ cik: Number(row.cik), ticker: String(row.ticker).trim().toUpperCase() }));
const today = new Date().toISOString().slice(0, 10);
const todo = pickTickers(registry, manifest, today, limit);
const prog = startProgress("alpha-vantage-earnings", `${registry.length} registry tickers · ${Object.values(manifest.tickers).filter(entry => entry.files.length).length} stored · today ${todo.length}${dryRun ? " · dry run" : ""}`);
if (dryRun) {
  prog.done(`dry run · would ask: ${todo.map(row => row.ticker).join(", ")}`);
  process.exit(0);
}

let requests = 0, stored = 0, empty = 0, stoppedBy: string | null = null;
const ask = async (symbol: string) => {
  if (requests > 0) await new Promise(resolve => setTimeout(resolve, SPACING_MS));
  requests++;
  const url = `${ALPHA_VANTAGE_URL}?function=EARNINGS&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "research-client/1.0" }, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new Error(`Alpha Vantage ${symbol}: ${error instanceof Error ? error.name : "request"} failed`);   // never the URL
  }
  if (!response.ok) throw new Error(`Alpha Vantage ${symbol}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { body, answer: classifyAnswer(JSON.parse(body.toString("utf8"))) };
};

try {
  outer: for (const company of todo) {
    const entry = manifest.tickers[company.ticker] ?? { cik: company.cik, ticker: company.ticker, symbol: null, files: [] };
    if (entry.cik !== company.cik) throw new Error(`${company.ticker} is stored for CIK ${entry.cik}, the registry now says ${company.cik}; resolve before fetching`);
    let found = false;
    for (const symbol of entry.symbol ? [entry.symbol] : symbolsFor(company.ticker)) {
      if (requests >= limit) break outer;
      const { body, answer } = await ask(symbol);
      if (answer.kind === "limit") { stoppedBy = `rate limit: ${answer.message}`; break outer; }
      if (answer.kind === "refused") throw new Error(`Alpha Vantage refused ${symbol}: ${answer.message}`);
      if (answer.kind === "empty") continue;
      if (answer.symbol && answer.symbol.toUpperCase() !== symbol) throw new Error(`Asked ${symbol}, the answer is for ${answer.symbol}; nothing was stored`);
      const dir = path.join(raw, company.ticker), file = path.join(dir, `${today}.json`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, body, { flag: "wx" });
      const ends = answer.quarters.map(row => row.fiscalDateEnding).sort();
      entry.symbol = symbol;
      entry.files.push({ date: today, file: path.relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length, quarters: answer.quarters.length,
        withEstimate: answer.quarters.filter(row => row.estimatedEPS !== null).length, first: ends[0] ?? null, last: ends.at(-1) ?? null });
      manifest.tickers[company.ticker] = entry;
      writeJsonAtomic(manifestFile, manifest, true);
      stored++;
      found = true;
      prog.log(`${company.ticker}${symbol !== company.ticker ? ` (as ${symbol})` : ""} · ${answer.quarters.length} quarters ${ends[0]} to ${ends.at(-1)} · ${entry.files.at(-1)!.withEstimate} with an estimate`);
      break;
    }
    if (!found && requests <= limit && !stoppedBy) {
      entry.empty = [...(entry.empty ?? []), today];
      manifest.tickers[company.ticker] = entry;
      writeJsonAtomic(manifestFile, manifest, true);
      empty++;
      prog.log(`${company.ticker} · no earnings under ${symbolsFor(company.ticker).join(" or ")}`);
    }
  }
} finally {
  manifest.runs.push({ at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), requests, stored, empty, stoppedBy });
  writeJsonAtomic(manifestFile, manifest, true);
}
const total = Object.values(manifest.tickers).filter(entry => entry.files.length).length;
prog.done(`${requests} requests · stored ${stored} · empty ${empty}${stoppedBy ? ` · stopped by ${stoppedBy}` : ""} · ${total} of ${registry.length} tickers stored`);
process.exit(0);
