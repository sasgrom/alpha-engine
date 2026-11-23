/**
 * Builds the per-company statements files behind the desk Company page from the standard fundamentals on D:
 * (the research standard's own files; the research database is never read here, and nothing is written to it).
 *
 *   npx tsx scripts/build-desk-company.mts [--source <standard folder>] [--out <folder>] [--quarters 20] [--dry-run]
 *
 * Source: D:\research\alpha-engine\fundamentals\standard\v3.1 (index.json with the field list, company\<cik>.json).
 * Output: worker/.runs/desk-company/statements/<cik>.json and index.json, written atomically. A missing or unreadable
 * source stops the build and leaves the previous files in place (AGENTS.md section 3.1: a missing D: is never an
 * empty archive).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyIndex } from "../contracts/desk-company";
import { buildDeskCompanyStatements, type StandardCompanyDoc, type StandardField } from "../worker/lib/desk-company";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const source = path.resolve(arg("--source") ?? "D:/research/alpha-engine/fundamentals/standard/v3.1");
const out = path.resolve(arg("--out") ?? "worker/.runs/desk-company");
const quarters = Number(arg("--quarters") ?? 20);
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

const standard = path.basename(source);
const builtAt = new Date().toISOString();
const hash = createHash("sha256");
const companies: DeskCompanyIndex["companies"] = [];
let bytes = 0;
for (const name of files) {
  const doc = JSON.parse(readFileSync(path.join(companyDir, name), "utf8")) as StandardCompanyDoc;
  const built = buildDeskCompanyStatements({ doc, fields: index.fields, standard, standardGeneratedAt: index.generatedAt, builtAt, quarters });
  // The hash covers what the page shows, not the build time, so an unchanged standard gives an unchanged hash.
  const { builtAt: _builtAt, ...stable } = built;
  const text = JSON.stringify(stable);
  hash.update(`${built.cik}\0${text}\0`);
  bytes += text.length;
  const rows = built.statements.income.length + built.statements.balance.length + built.statements.cashflow.length;
  companies.push({ cik: built.cik, ticker: built.ticker, quarters: built.quarters.length, lastQuarter: built.quarters.at(-1)?.end ?? null, rows });
  if (!dryRun) writeJsonAtomic(path.join(out, "statements", `${built.cik}.json`), built);
}
const summary: DeskCompanyIndex = { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, standard, standardGeneratedAt: index.generatedAt, builtAt, contentHash: hash.digest("hex"), companies };
if (!dryRun) writeJsonAtomic(path.join(out, "index.json"), summary, true);
const empty = companies.filter((company) => company.quarters === 0).length;
console.log(`[desk-company] ${dryRun ? "dry run · " : ""}${companies.length} companies from standard ${standard} (${index.generatedAt}) · ${quarters} quarters each · ${(bytes / 1_048_576).toFixed(1)} MB · ${empty} without own quarters · hash ${summary.contentHash.slice(0, 12)} · ${out}`);
