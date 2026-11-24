/**
 * Builds the per-company files behind the desk Company page from the research standards on D: (the standards' own
 * files; the research database is never read here, and nothing is written to it):
 *   statements/<cik>.json  40 quarters of income, balance sheet and cash flow lines, with fiscal-year and trailing-year
 *                          figures, from the standard fundamentals (splits from the standard prices set the share basis)
 *   guidance/<cik>.json    what the company guided for each period, release after release, and what it then reported,
 *                          from the guidance standard and the standard fundamentals
 *   actions/<cik>.json     splits, dividends and other distributions, from the standard prices
 *   holders/<cik>.json     20 quarters of fund holdings (holders, share of the stock, entries and exits), from the 13F
 *                          standard's company quarters
 *   insiders/<cik>.json    three years of insider stock transactions and 20 quarters of open-market purchases and
 *                          sales, from the insider standard's per-company files
 *   insiders-market.json   the same lines across companies: the last 90 days' totals, recent purchases, windows of
 *                          several buying insiders, the largest net buyers and sellers
 *   filings/<cik>.json     five years of 10-K, 10-Q and 8-K filings with the cached exhibits of the earnings releases,
 *                          from the release calendar (D:\research\alpha-engine\engine\events, --calendar)
 *
 *   npx tsx scripts/build-desk-company.mts [--source <fundamentals standard folder>] [--guidance <guidance build folder>]
 *                                           [--prices <standard prices daily folder>] [--holders <13F standard folder>]
 *                                           [--insiders <insider standard build folder>] [--calendar <release calendar folder>]
 *                                           [--exhibits <EDGAR exhibit cache>] [--adjusted <adjusted-eps build folder>]
 *                                           [--out <folder>] [--quarters 40] [--dry-run]
 *
 * Defaults: D:\research\alpha-engine\fundamentals\standard\v3.2 (share counts and per-share figures back on their scale,
 * docs/engine/STANDARD_FUNDAMENTALS.md section 10), D:\research\alpha-engine\guidance\std\20261123T033803Z (g1.2 final),
 * D:\research\alpha-engine\prices\std\daily, D:\research\alpha-engine\fund-books\std-k16.6 (k16.6 with the September
 * 2026 quarter; files only, the research database keeps the final k16.5), D:\research\alpha-engine\insiders\std\20261116T223552Z
 * (i1.1 final), D:\research\alpha-engine\engine\events, worker/cache/edgar and D:\research\alpha-engine\engine\adjusted-eps\a8.
 * Output: worker/.runs/desk-company, written atomically, with index.json. A missing or unreadable source stops the build and leaves the previous files in place (AGENTS.md
 * section 3.1: a missing D: is never an empty archive).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyIndex, type DeskCompanyInsiders } from "../contracts/desk-company";
import {
  buildDeskCompanyActions, buildDeskCompanyFilings, buildDeskCompanyGuidance, buildDeskCompanyHolders, buildDeskCompanyInsiders, buildDeskCompanyStatements, buildDeskInsiderMarket, isGuidanceRow,
  type AdjustedEpsActual, type CalendarFilingRow, type GuidanceStatementRow, type InsiderFilingDoc, type StandardCompanyDoc, type StandardField, type StandardPriceRow, type ThirteenFCompanyQuarter,
} from "../worker/lib/desk-company";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const source = path.resolve(arg("--source") ?? "D:/research/alpha-engine/fundamentals/standard/v3.2");
const guidanceDir = path.resolve(arg("--guidance") ?? "D:/research/alpha-engine/guidance/std/20261123T033803Z");
const pricesDir = path.resolve(arg("--prices") ?? "D:/research/alpha-engine/prices/std/daily");
const holdersDir = path.resolve(arg("--holders") ?? "D:/research/alpha-engine/fund-books/std-k16.6");
const insidersDir = path.resolve(arg("--insiders") ?? "D:/research/alpha-engine/insiders/std/20261116T223552Z");
const calendarDir = path.resolve(arg("--calendar") ?? "D:/research/alpha-engine/engine/events");
// The adjusted earnings per share the releases print (scripts/build-adjusted-eps.mts), beside the adjusted guidance;
// a read that is missing stops the build (below).
const adjustedDir = path.resolve(arg("--adjusted") ?? "D:/research/alpha-engine/engine/adjusted-eps/a8");
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

// The 13F standard: its company quarters, checked against its manifest's row count.
const holdersBuildFile = path.join(holdersDir, "build.json");
const holdersFile = path.join(holdersDir, "company-quarters.jsonl");
if (!existsSync(holdersBuildFile) || !existsSync(holdersFile)) throw new Error(`13F standard not found at ${holdersDir}; nothing was changed`);
const holdersBuild = JSON.parse(readFileSync(holdersBuildFile, "utf8")) as { buildVersion: string; companyQuarterRows: number };
const holderRows = new Map<number, ThirteenFCompanyQuarter[]>();
let holdersRead = 0, holdersPeriod: string | null = null;
for await (const line of createInterface({ input: createReadStream(holdersFile, "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  holdersRead++;
  const row = JSON.parse(line) as ThirteenFCompanyQuarter;
  if (row.buildVersion !== holdersBuild.buildVersion) throw new Error(`${holdersFile} holds build ${row.buildVersion}, its manifest ${holdersBuild.buildVersion}`);
  holderRows.set(row.cik, [...(holderRows.get(row.cik) ?? []), row]);
  if (holdersPeriod === null || row.period > holdersPeriod) holdersPeriod = row.period;
}
if (holdersRead !== holdersBuild.companyQuarterRows) throw new Error(`13F company quarters read ${holdersRead}, the manifest says ${holdersBuild.companyQuarterRows}; nothing was changed`);

// The release calendar: the 10-K, 10-Q and 8-K filings of the research 50, of the other index companies and of the six added later.
const calendarFiles = ["filings-50.jsonl", "filings-rest.jsonl", "filings-six.jsonl"].map((name) => path.join(calendarDir, name));
if (calendarFiles.slice(0, 2).some((file) => !existsSync(file))) throw new Error(`Release calendar not found at ${calendarDir}; nothing was changed`);
const filingRows = new Map<number, CalendarFilingRow[]>();
let filingsAsOf: string | null = null;
for (const file of calendarFiles.filter((name) => existsSync(name))) {
  for await (const line of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
    if (!line) continue;
    const row = JSON.parse(line) as CalendarFilingRow;
    filingRows.set(row.cik, [...(filingRows.get(row.cik) ?? []), {
      cik: row.cik, accessionNo: row.accessionNo, form: row.form, filingDate: row.filingDate, reportDate: row.reportDate, acceptedEt: row.acceptedEt, items: row.items,
      isEarningsRelease: row.isEarningsRelease, primaryDoc: row.primaryDoc, cachedFiles: row.isEarningsRelease ? row.cachedFiles : [],
    }]);
    if (filingsAsOf === null || row.filingDate > filingsAsOf) filingsAsOf = row.filingDate;
  }
}
if (!filingsAsOf) throw new Error(`Release calendar at ${calendarDir} holds no filings; nothing was changed`);
// The exhibits of an earnings release are taken from the exhibit cache itself (the folder the release-figure builder
// reads), because the calendar of the research 50 does not list them: every cached file named <accession>.ex*.htm.
const exhibitCache = path.resolve(arg("--exhibits") ?? "worker/cache/edgar");
if (!existsSync(exhibitCache)) throw new Error(`Exhibit cache not found at ${exhibitCache}; nothing was changed`);
function withCachedExhibits(cik: number, rows: CalendarFilingRow[]): CalendarFilingRow[] {
  const directory = path.join(exhibitCache, String(cik));
  if (!existsSync(directory)) return rows;
  const names = readdirSync(directory).filter((name) => /^\d{18}\.ex.*\.html?$/.test(name));
  const byStem = new Map<string, string[]>();
  for (const name of names) byStem.set(name.slice(0, 18), [...(byStem.get(name.slice(0, 18)) ?? []), name]);
  return rows.map((row) => {
    const found = row.isEarningsRelease ? byStem.get(row.accessionNo.replaceAll("-", "")) : undefined;
    return found ? { ...row, cachedFiles: found.map((name) => ({ name, bytes: statSync(path.join(directory, name)).size })) } : row;
  });
}

// The insider standard: one file of filings per company; only a build marked final is read.
const insidersFinalFile = path.join(insidersDir, "finalization.json");
const insidersCompanies = path.join(insidersDir, "companies");
if (!existsSync(insidersFinalFile) || !existsSync(insidersCompanies)) throw new Error(`Insider standard not found at ${insidersDir}; nothing was changed`);
const insidersFinal = JSON.parse(readFileSync(insidersFinalFile, "utf8")) as { status: string; buildVersion: string };
if (insidersFinal.status !== "final") throw new Error(`Insider standard at ${insidersDir} is ${insidersFinal.status}, not final; nothing was changed`);
/** Only the filings of the last years are kept, slimmed to what the page uses. */
const INSIDER_YEARS = 6;
const insiderSince = new Date(Date.now() - INSIDER_YEARS * 365.25 * 86_400_000).toISOString().slice(0, 10);
async function insiderFilings(cik: number): Promise<InsiderFilingDoc[] | null> {
  const file = path.join(insidersCompanies, `${cik}.jsonl`);
  if (!existsSync(file)) return null;
  const filings: InsiderFilingDoc[] = [];
  for await (const line of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
    if (!line) continue;
    const doc = JSON.parse(line) as InsiderFilingDoc;
    if (doc.filing.buildVersion !== insidersFinal.buildVersion) throw new Error(`${file} holds build ${doc.filing.buildVersion}, the standard is ${insidersFinal.buildVersion}`);
    if (doc.filing.filingDate < insiderSince) continue;
    filings.push({
      filing: { accessionNo: doc.filing.accessionNo, form: doc.filing.form, filingDate: doc.filing.filingDate, buildVersion: doc.filing.buildVersion },
      owners: doc.owners.map((owner) => ({ ownerName: owner.ownerName, groupId: owner.groupId, director: owner.director, officer: owner.officer, officerTitle: owner.officerTitle, tenPercentOwner: owner.tenPercentOwner })),
      transactions: doc.transactions.filter((line) => !line.derivative).map((line) => ({
        groupId: line.groupId, derivative: line.derivative, transactionDate: line.transactionDate, code: line.code, shares: line.shares, price: line.price,
        valueUsd: line.valueUsd, plan10b5: line.plan10b5, duplicateOf: line.duplicateOf, flags: line.flags, directOrIndirect: line.directOrIndirect ?? null,
      })),
    });
  }
  return filings;
}

const adjustedActuals = new Map<number, AdjustedEpsActual[]>();
// the adjusted figures are part of the page: a read that is missing is never an empty one (AGENTS.md section 3.1)
if (!existsSync(path.join(adjustedDir, "figures.jsonl")) || !existsSync(path.join(adjustedDir, "summary.json"))) throw new Error(`Adjusted-earnings read not found at ${adjustedDir} (figures.jsonl, summary.json); nothing was changed`);
const adjustedVersion = (JSON.parse(readFileSync(path.join(adjustedDir, "summary.json"), "utf8")) as { version: string }).version;
for await (const line of createInterface({ input: createReadStream(path.join(adjustedDir, "figures.jsonl"), "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  const row = JSON.parse(line) as { cik: number; acceptedEt: string; fiscalPeriodEnd: string; quarter: { value: number; grade: string } | null; year: { value: number; grade: string } | null };
  const usable = (figure: { value: number; grade: string } | null) => figure !== null && (figure.grade === "confirmed" || figure.grade === "same_row");
  const list = adjustedActuals.get(row.cik) ?? adjustedActuals.set(row.cik, []).get(row.cik)!;
  // a release accepted after the close counts from the next day, like the guidance standard's availability
  const released = row.acceptedEt.slice(11, 16) >= "16:00" ? new Date(Date.parse(`${row.acceptedEt.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : row.acceptedEt.slice(0, 10);
  if (usable(row.quarter)) list.push({ kind: "Q", periodEnd: row.fiscalPeriodEnd, value: row.quarter!.value, released });
  if (usable(row.year)) list.push({ kind: "FY", periodEnd: row.fiscalPeriodEnd, value: row.year!.value, released });
}

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
let bytes = 0, withGuidance = 0, withActions = 0, withHolders = 0, withFilings = 0, outOfScale = 0, pricesAsOf: string | null = null;
const insiderInputs: Array<{ cik: number; ticker: string; filings: InsiderFilingDoc[]; at: number }> = [];
let insidersAsOf: string | null = null;
for (const name of files) {
  const doc = JSON.parse(readFileSync(path.join(companyDir, name), "utf8")) as StandardCompanyDoc;
  const prices = priceRows(doc.cik);
  const actions = prices ? buildDeskCompanyActions({ cik: doc.cik, ticker: doc.ticker, rows: prices, builtAt }) : null;
  // without a standard price file the splits are unknown: no share basis, so no fiscal-year or trailing-year per-share figures
  const statements = buildDeskCompanyStatements({ doc, fields: index.fields, standard, standardGeneratedAt: index.generatedAt, builtAt, quarters, splits: actions ? actions.splits : null });
  const guidance = buildDeskCompanyGuidance({ doc, rows: guidanceRows.get(doc.cik) ?? [], guidanceVersion: guidanceBuild.guidanceVersion, standard, builtAt, adjusted: adjustedActuals.get(doc.cik), adjustedVersion });
  const holders = buildDeskCompanyHolders({ cik: doc.cik, ticker: doc.ticker, rows: holderRows.get(doc.cik) ?? [], builtAt });
  const filings = await insiderFilings(doc.cik);
  if (filings) {
    for (const item of filings) if (insidersAsOf === null || item.filing.filingDate > insidersAsOf) insidersAsOf = item.filing.filingDate;
    insiderInputs.push({ cik: doc.cik, ticker: doc.ticker, filings, at: companies.length });
  }
  const filed = buildDeskCompanyFilings({ cik: doc.cik, ticker: doc.ticker, rows: withCachedExhibits(doc.cik, filingRows.get(doc.cik) ?? []), asOf: filingsAsOf, builtAt });
  if (filed) withFilings++;
  const texts = [stable(statements), stable(guidance), actions ? stable(actions) : "null", holders ? stable(holders) : "null", filed ? stable(filed) : "null"];
  hash.update(`${doc.cik}\0${texts.join("\0")}\0`);
  bytes += texts.reduce((sum, text) => sum + text.length, 0);
  if (guidance.periods.length) withGuidance++;
  if (holders) withHolders++;
  if (actions) {
    withActions++;
    if (pricesAsOf === null || actions.pricesAsOf > pricesAsOf) pricesAsOf = actions.pricesAsOf;
  }
  const rows = statements.statements.income.length + statements.statements.balance.length + statements.statements.cashflow.length;
  for (const row of [...statements.statements.income, ...statements.statements.balance]) outOfScale += row.cells.filter((cell) => cell?.suspect).length;
  companies.push({ cik: doc.cik, ticker: doc.ticker, quarters: statements.quarters.length, lastQuarter: statements.quarters.at(-1)?.end ?? null, rows, guidancePeriods: guidance.periods.length, actions: actions !== null, holders: holders !== null, insiderTrades: 0, filings: filed?.filings.length ?? 0 });
  if (dryRun) continue;
  writeJsonAtomic(path.join(out, "statements", `${doc.cik}.json`), statements);
  // a company without guidance, or without a standard price file, gets no file: the page says so instead of guessing
  if (guidance.periods.length) writeJsonAtomic(path.join(out, "guidance", `${doc.cik}.json`), guidance);
  if (actions) writeJsonAtomic(path.join(out, "actions", `${doc.cik}.json`), actions);
  if (holders) writeJsonAtomic(path.join(out, "holders", `${doc.cik}.json`), holders);
  if (filed) writeJsonAtomic(path.join(out, "filings", `${doc.cik}.json`), filed);
}
// The insider windows end at the last filing date of all companies, so these files are built after the loop, in the same order.
let withInsiders = 0;
for (const input of insiderInputs) {
  const insiders: DeskCompanyInsiders | null = insidersAsOf ? buildDeskCompanyInsiders({ cik: input.cik, ticker: input.ticker, filings: input.filings, asOf: insidersAsOf, builtAt }) : null;
  const text = insiders ? stable(insiders) : "null";
  hash.update(`${input.cik}|insiders|${text}|`);
  bytes += text.length;
  if (!insiders) continue;
  withInsiders++;
  companies[input.at].insiderTrades = insiders.tradeCount;
  if (!dryRun) writeJsonAtomic(path.join(out, "insiders", `${input.cik}.json`), insiders);
}
// The same lines across companies, for the Ownership page: recent totals, purchases, buying windows, net buyers and sellers.
const insiderMarket = insidersAsOf ? buildDeskInsiderMarket({ companies: insiderInputs, asOf: insidersAsOf, builtAt }) : null;
hash.update(`insiders-market|${insiderMarket ? stable(insiderMarket) : "null"}|`);
if (insiderMarket && !dryRun) writeJsonAtomic(path.join(out, "insiders-market.json"), insiderMarket);
const summary: DeskCompanyIndex = {
  schemaVersion: DESK_COMPANY_SCHEMA_VERSION, standard, standardGeneratedAt: index.generatedAt, guidanceVersion: guidanceBuild.guidanceVersion, pricesAsOf,
  holdersVersion: holdersBuild.buildVersion, holdersPeriod, insidersVersion: insidersFinal.buildVersion, insidersAsOf, filingsAsOf, builtAt,
  contentHash: hash.digest("hex"), companies,
};
if (!dryRun) writeJsonAtomic(path.join(out, "index.json"), summary, true);
const empty = companies.filter((company) => company.quarters === 0).length;
console.log(`[desk-company] ${dryRun ? "dry run · " : ""}${companies.length} companies · statements from ${standard} (${quarters} quarters, ${empty} without own quarters, ${outOfScale} share or per-share figures marked out of scale) · guidance ${guidanceBuild.guidanceVersion} for ${withGuidance} (adjusted earnings ${adjustedVersion ?? "not read"} for ${adjustedActuals.size} companies) · splits and dividends for ${withActions} (prices to ${pricesAsOf}) · holders ${holdersBuild.buildVersion} for ${withHolders} (to ${holdersPeriod}) · insiders ${insidersFinal.buildVersion} for ${withInsiders} (filings to ${insidersAsOf}) · filings for ${withFilings} (calendar to ${filingsAsOf}) · ${(bytes / 1_048_576).toFixed(1)} MB · hash ${summary.contentHash.slice(0, 12)} · ${out}`);
