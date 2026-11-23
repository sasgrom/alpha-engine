/**
 * Builds the per-company files behind the desk Company page from the research standards on D: (the standards' own
 * files; the research database is never read here, and nothing is written to it):
 *   statements/<cik>.json  40 quarters of income, balance sheet and cash flow lines, with fiscal-year and trailing-year
 *                          figures, from the standard fundamentals (splits from the standard prices set the share basis)
 *   guidance/<cik>.json    what the company guided for each period, release after release, and what it then reported,
 *                          from the guidance standard and the standard fundamentals
 *   actions/<cik>.json     splits, dividends and other distributions, from the standard prices
 *
 *   npx tsx scripts/build-desk-company.mts [--source <fundamentals standard folder>] [--guidance <guidance build folder>]
 *                                           [--prices <standard prices daily folder>] [--out <folder>] [--quarters 40] [--dry-run]
 *
 * Defaults: D:\research\alpha-engine\fundamentals\standard\v3.1, D:\research\alpha-engine\guidance\std\20261123T033803Z
 * (g1.2 final), D:\research\alpha-engine\prices\std\daily. Output: worker/.runs/desk-company, written atomically, with
 * index.json. A missing or unreadable source stops the build and leaves the previous files in place (AGENTS.md
 * section 3.1: a missing D: is never an empty archive).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyIndex } from "../contracts/desk-company";
import {
  buildDeskCompanyActions, buildDeskCompanyGuidance, buildDeskCompanyStatements, isGuidanceRow,
  type GuidanceStatementRow, type StandardCompanyDoc, type StandardField, type StandardPriceRow,
} from "../worker/lib/desk-company";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const source = path.resolve(arg("--source") ?? "D:/research/alpha-engine/fundamentals/standard/v3.1");
const guidanceDir = path.resolve(arg("--guidance") ?? "D:/research/alpha-engine/guidance/std/20261123T033803Z");
const pricesDir = path.resolve(arg("--prices") ?? "D:/research/alpha-engine/prices/std/daily");
const out = path.resolve(arg("--out") ?? "worker/.runs/desk-company");
const quarters = Number(arg("--quarters") ?? 40);
const dryRun = process.argv.includes("--dry-run");
if (!Number.isInteger(quarters) || quarters < 4) throw new Error("--quarters must be an integer of at least 4");

const indexFile = path.join(source, "index.json");
const companyDir = path.join(source, "company");
if (!existsSync(indexFile) || !existsSync(companyDir)) throw new Error(`Standard fundamentals not found at ${source}; nothing was changed`);
const index = JSON.parse(readFileSync(indexFile, "utf8")) as { schemaVersion: number; generatedAt: string; fields: StandardField[]; companies: Array<{ cik: number; quarters: number }> };
if (index.schemaVersion !== 2 || !Array.isArray(index.fields) || !index.fields.length) throw new Error(`Unexpected standard index at ${indexFile}`);
const files = readdirSync(companyDir).filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
// The index also lists companies without any quarter (a predecessor merged into its successor, a filer without
// us-gaap data); those have no file by design. Every company with quarters must have one.
const present = new Set(files.map((name) => Number.parseInt(name, 10)));
const missing = index.companies.filter((company) => company.quarters > 0 && !present.has(company.cik)).map((company) => company.cik);
if (missing.length) throw new Error(`Standard is incomplete: no file for ${missing.length} companies with quarters (${missing.slice(0, 5).join(", ")}); nothing was changed`);

// The guidance standard: one build folder with its own manifest; its statements are read once and kept per company.
const guidanceBuildFile = path.join(guidanceDir, "build.json");
const guidanceFile = path.join(guidanceDir, "statements.jsonl");
if (!existsSync(guidanceBuildFile) || !existsSync(guidanceFile)) throw new Error(`Guidance standard not found at ${guidanceDir}; nothing was changed`);
const guidanceBuild = JSON.parse(readFileSync(guidanceBuildFile, "utf8")) as { guidanceVersion: string; rows: { statements: number } };
const guidanceRows = new Map<number, GuidanceStatementRow[]>();
let guidanceRead = 0;
for await (const line of createInterface({ input: createReadStream(guidanceFile, "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  guidanceRead++;
  const row = JSON.parse(line) as GuidanceStatementRow & { guidanceVersion: string };
  if (row.guidanceVersion !== guidanceBuild.guidanceVersion) throw new Error(`${guidanceFile} holds version ${row.guidanceVersion}, its manifest ${guidanceBuild.guidanceVersion}`);
  if ((row.metric !== "revenue" && row.metric !== "eps") || !isGuidanceRow(row)) continue;
  const kept: GuidanceStatementRow = {
    cik: row.cik, availableFrom: row.availableFrom, acceptedEt: row.acceptedEt, metric: row.metric, basis: row.basis, periodKind: row.periodKind, periodEnd: row.periodEnd,
    timing: row.timing, duplicateOf: row.duplicateOf, flags: row.flags, low: row.low, high: row.high, mid: row.mid, unit: row.unit,
  };
  guidanceRows.set(row.cik, [...(guidanceRows.get(row.cik) ?? []), kept]);
}
if (guidanceRead !== guidanceBuild.rows.statements) throw new Error(`Guidance statements read ${guidanceRead}, the manifest says ${guidanceBuild.rows.statements}; nothing was changed`);

if (!existsSync(pricesDir)) throw new Error(`Standard prices not found at ${pricesDir}; nothing was changed`);
function priceRows(cik: number): StandardPriceRow[] | null {
  const file = path.join(pricesDir, `${cik}.csv`);
  if (!existsSync(file)) return null;
  const [header, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const names = header.split(",");
  const at = (name: string) => { const i = names.indexOf(name); if (i < 0) throw new Error(`${file} has no column ${name}`); return i; };
  const [date, close, dividend, splitRatio, distribution] = [at("date"), at("close"), at("dividend"), at("splitRatio"), at("distribution")];
  return lines.map((line) => { const cells = line.split(","); return { date: cells[date], close: cells[close], dividend: cells[dividend], splitRatio: cells[splitRatio], distribution: cells[distribution] }; });
}

const standard = path.basename(source);
const builtAt = new Date().toISOString();
const hash = createHash("sha256");
// The hash covers what the page shows, not the build time, so unchanged standards give an unchanged hash.
const stable = (value: { builtAt: string }) => { const { builtAt: _builtAt, ...rest } = value; return JSON.stringify(rest); };
const companies: DeskCompanyIndex["companies"] = [];
let bytes = 0, withGuidance = 0, withActions = 0, outOfScale = 0, pricesAsOf: string | null = null;
for (const name of files) {
  const doc = JSON.parse(readFileSync(path.join(companyDir, name), "utf8")) as StandardCompanyDoc;
  const prices = priceRows(doc.cik);
  const actions = prices ? buildDeskCompanyActions({ cik: doc.cik, ticker: doc.ticker, rows: prices, builtAt }) : null;
  // without a standard price file the splits are unknown: no share basis, so no fiscal-year or trailing-year per-share figures
  const statements = buildDeskCompanyStatements({ doc, fields: index.fields, standard, standardGeneratedAt: index.generatedAt, builtAt, quarters, splits: actions ? actions.splits : null });
  const guidance = buildDeskCompanyGuidance({ doc, rows: guidanceRows.get(doc.cik) ?? [], guidanceVersion: guidanceBuild.guidanceVersion, standard, builtAt });
  const texts = [stable(statements), stable(guidance), actions ? stable(actions) : "null"];
  hash.update(`${doc.cik}\0${texts.join("\0")}\0`);
  bytes += texts.reduce((sum, text) => sum + text.length, 0);
  if (guidance.periods.length) withGuidance++;
  if (actions) {
    withActions++;
    if (pricesAsOf === null || actions.pricesAsOf > pricesAsOf) pricesAsOf = actions.pricesAsOf;
  }
  const rows = statements.statements.income.length + statements.statements.balance.length + statements.statements.cashflow.length;
  for (const row of [...statements.statements.income, ...statements.statements.balance]) outOfScale += row.cells.filter((cell) => cell?.suspect).length;
  companies.push({ cik: doc.cik, ticker: doc.ticker, quarters: statements.quarters.length, lastQuarter: statements.quarters.at(-1)?.end ?? null, rows, guidancePeriods: guidance.periods.length, actions: actions !== null });
  if (dryRun) continue;
  writeJsonAtomic(path.join(out, "statements", `${doc.cik}.json`), statements);
  // a company without guidance, or without a standard price file, gets no file: the page says so instead of guessing
  if (guidance.periods.length) writeJsonAtomic(path.join(out, "guidance", `${doc.cik}.json`), guidance);
  if (actions) writeJsonAtomic(path.join(out, "actions", `${doc.cik}.json`), actions);
}
const summary: DeskCompanyIndex = {
  schemaVersion: DESK_COMPANY_SCHEMA_VERSION, standard, standardGeneratedAt: index.generatedAt, guidanceVersion: guidanceBuild.guidanceVersion, pricesAsOf, builtAt,
  contentHash: hash.digest("hex"), companies,
};
if (!dryRun) writeJsonAtomic(path.join(out, "index.json"), summary, true);
const empty = companies.filter((company) => company.quarters === 0).length;
console.log(`[desk-company] ${dryRun ? "dry run · " : ""}${companies.length} companies · statements from ${standard} (${quarters} quarters, ${empty} without own quarters, ${outOfScale} share or per-share figures marked out of scale) · guidance ${guidanceBuild.guidanceVersion} for ${withGuidance} · splits and dividends for ${withActions} (prices to ${pricesAsOf}) · ${(bytes / 1_048_576).toFixed(1)} MB · hash ${summary.contentHash.slice(0, 12)} · ${out}`);
