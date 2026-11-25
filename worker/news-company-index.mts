/**
 * The company index the news reader resolves names with (worker/news-extract.mts). Research input; no production write.
 *
 *   npx tsx worker/news-company-index.mts [--no-fetch]
 *
 * Joins three sources: the SEC's company list with tickers (fetched through secGet once a day at most and kept as
 * received in news/lookup/<UTC date>-company_tickers.json), the Russell 1000 identities of K26 with former names, and
 * our registry (alpha_engine.companies, read only). Writes news/lookup/company-index.json atomically; the previous
 * index stays in place if any source is missing.
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDb } from "../api/queries/connection";
import { secGet } from "./lib/edgar";
import { writeJsonAtomic } from "./lib/json-file";

const lookup = "D:/research/alpha-engine/news/lookup";
const russellFile = "D:/research/alpha-engine/index-membership/russell1000/companies.json";
if (!existsSync(lookup) || !/^d:/i.test(realpathSync(lookup))) throw new Error(`The lookup folder ${lookup} is missing or not on D:; nothing was written`);
if (!existsSync(russellFile)) throw new Error(`No Russell 1000 identities at ${russellFile}; nothing was written`);

const day = new Date().toISOString().slice(0, 10);
let secFile = path.join(lookup, `${day}-company_tickers.json`);
if (!existsSync(secFile) && !process.argv.includes("--no-fetch")) {
  const response = await secGet("https://www.sec.gov/files/company_tickers.json");
  const body = Buffer.from(await response.arrayBuffer());
  JSON.parse(body.toString("utf8"));                                    // a broken answer is not kept
  writeFileSync(secFile, body, { flag: "wx" });
  console.log(JSON.stringify({ fetched: secFile, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }));
}
if (!existsSync(secFile)) {
  const latest = readdirSync(lookup).filter(name => /^\d{4}-\d{2}-\d{2}-company_tickers\.json$/.test(name)).sort().at(-1);
  if (!latest) throw new Error("No SEC company list on hand; nothing was written");
  secFile = path.join(lookup, latest);
}

type Entry = { cik: number; tickers: string[]; names: string[]; status?: string; sources: string[] };
const entries = new Map<number, Entry>();
const entry = (cik: number) => { let found = entries.get(cik); if (!found) { found = { cik, tickers: [], names: [], sources: [] }; entries.set(cik, found); } return found; };
const add = (list: string[], value: string | undefined | null) => { if (value && !list.includes(value)) list.push(value); };
const ticker = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase().replace("-", ".") || null;

const sec = JSON.parse(readFileSync(secFile, "utf8")) as Record<string, { cik_str: number; ticker: string; title: string }>;
for (const row of Object.values(sec)) { const found = entry(row.cik_str); add(found.tickers, ticker(row.ticker)); add(found.names, row.title); add(found.sources, "sec"); }
const russell = JSON.parse(readFileSync(russellFile, "utf8")) as { companies?: any[] };
for (const row of russell.companies ?? []) {
  if (!row?.cik) continue;
  const found = entry(Number(row.cik));
  for (const value of row.tickers ?? []) add(found.tickers, ticker(value));
  add(found.names, row.name);
  for (const former of row.formerNames ?? []) add(found.names, typeof former === "string" ? former : former?.name);
  found.status = row.status; add(found.sources, "russell1000");
}
const client = getDb().$client.promise();
const [rows] = await client.query("SELECT cik, ticker, name FROM companies WHERE cik > 0") as [Array<{ cik: number; ticker: string | null; name: string | null }>, unknown];
await client.end();
for (const row of rows) { const found = entry(Number(row.cik)); add(found.tickers, ticker(row.ticker)); add(found.names, row.name); add(found.sources, "registry"); }

const list = [...entries.values()].sort((a, b) => a.cik - b.cik);
if (list.length < 5000) throw new Error(`Only ${list.length} companies in the joined index; the previous index stays in place`);
writeJsonAtomic(path.join(lookup, "company-index.json"), { schemaVersion: 1, builtAt: new Date().toISOString(),
  sources: [path.basename(secFile), "index-membership/russell1000/companies.json (K26)", "alpha_engine.companies"], entries: list });
console.log(JSON.stringify({ entries: list.length, withTicker: list.filter(item => item.tickers.length).length, russell: list.filter(item => item.sources.includes("russell1000")).length, registry: list.filter(item => item.sources.includes("registry")).length }));
process.exit(0);
