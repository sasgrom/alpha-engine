/**
 * Checks the fiscal-year figures of the desk Company page against what the annual reports themselves filed.
 *
 * The page builds a fiscal year from four quarters of the standard fundamentals (worker/lib/desk-company.ts). This
 * script rebuilds every company in memory and sets each year's figure against the annual fact of the same tag in the
 * SEC companyfacts cache (form 10-K, a span of 350 to 380 days ending at the fiscal year end, the first one filed).
 * A match is within 0.5% (per-share lines: within 0.5% or one cent). Lines the standard derived (no single tag) are
 * not compared, except per-share lines and share counts, which are compared with the standard's own tag list.
 * Read-only: nothing is written but --out.
 *
 *   npx tsx scripts/check-desk-company-years.mts [--source <fundamentals standard folder>] [--prices <standard prices daily folder>]
 *                                                [--out <json with the counts and the differences>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDeskCompanyActions, buildDeskCompanyStatements, type StandardCompanyDoc, type StandardField, type StandardPriceRow } from "../worker/lib/desk-company";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const source = path.resolve(arg("--source") ?? "D:/research/alpha-engine/fundamentals/standard/v3.2");
const pricesDir = path.resolve(arg("--prices") ?? "D:/research/alpha-engine/prices/std/daily");
const factsDir = path.resolve("worker/cache/companyfacts");
for (const folder of [path.join(source, "company"), pricesDir, factsDir]) if (!existsSync(folder)) throw new Error(`Not found: ${folder}`);

const index = JSON.parse(readFileSync(path.join(source, "index.json"), "utf8")) as { generatedAt: string; fields: Array<StandardField & { tags: string[] }> };
const fieldTags = new Map(index.fields.map((field) => [field.code, field.tags.map((tag) => tag.replace(/^-/, "")).filter((tag) => /^[A-Za-z0-9]+$/.test(tag))]));
const CHECK = ["revenue", "netinc", "opinc", "ncfo", "capex", "eps", "epsDil", "shareswaDil"];
const UNIT: Record<string, string> = { eps: "USD/shares", epsDil: "USD/shares", shareswaDil: "shares" };
const DAY = 86_400_000;

function priceRows(cik: number): StandardPriceRow[] | null {
  const file = path.join(pricesDir, `${cik}.csv`);
  if (!existsSync(file)) return null;
  const [header, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const names = header.split(",");
  const at = (name: string) => names.indexOf(name);
  const [date, close, dividend, splitRatio, distribution] = [at("date"), at("close"), at("dividend"), at("splitRatio"), at("distribution")];
  return lines.map((line) => { const cells = line.split(","); return { date: cells[date], close: cells[close], dividend: cells[dividend], splitRatio: cells[splitRatio], distribution: cells[distribution] }; });
}

type Fact = { start?: string; end: string; val: number; form: string; filed: string };
interface Count { years: number; built: number; compared: number; match: number; off: number; over5: number; over20: number; splitYears: number; splitMatch: number }
const counts: Record<string, Count> = {};
const differences: Array<Record<string, unknown>> = [];
const marked: Record<string, number> = {};
let companies = 0, checkedCells = 0;

for (const name of readdirSync(path.join(source, "company")).filter((file) => /^\d+\.json$/.test(file))) {
  const doc = JSON.parse(readFileSync(path.join(source, "company", name), "utf8")) as StandardCompanyDoc;
  const factsFile = path.join(factsDir, `${doc.cik}.json`);
  if (!existsSync(factsFile)) continue;
  companies++;
  const gaap = (JSON.parse(readFileSync(factsFile, "utf8")) as { facts?: { "us-gaap"?: Record<string, { units: Record<string, Fact[]> }> } }).facts?.["us-gaap"] ?? {};
  const prices = priceRows(doc.cik);
  const actions = prices ? buildDeskCompanyActions({ cik: doc.cik, ticker: doc.ticker, rows: prices, builtAt: "" }) : null;
  const out = buildDeskCompanyStatements({ doc, fields: index.fields, standard: path.basename(source), standardGeneratedAt: index.generatedAt, builtAt: "", splits: actions ? actions.splits : null });
  for (const row of [...out.statements.income, ...out.statements.balance]) {
    if (!["sharesBasic", "shareswa", "shareswaDil", "eps", "epsDil"].includes(row.code)) continue;
    for (const cell of row.cells) {
      if (!cell) continue;
      checkedCells++;
      if (cell.suspect) marked[row.code] = (marked[row.code] ?? 0) + 1;
    }
  }
  // the annual fact the 10-K filed for a tag: the first one filed for that fiscal year end
  const annualFact = (code: string, own: string | null, end: string): { value: number; tag: string } | null => {
    for (const tag of [...(own && own !== "derived" ? [own] : []), ...(fieldTags.get(code) ?? [])]) {
      const facts = Object.entries(gaap[tag]?.units ?? {}).filter(([unit]) => unit === (UNIT[code] ?? "USD") || (UNIT[code] === "USD/shares" && unit === "USD")).flatMap(([, list]) => list);
      const hits = facts
        .filter((fact) => fact.end === end && fact.start && fact.form.startsWith("10-K"))
        .filter((fact) => { const span = (Date.parse(fact.end) - Date.parse(fact.start!)) / DAY; return span >= 350 && span <= 380; })
        .sort((a, b) => a.filed.localeCompare(b.filed));
      if (hits.length) return { value: hits[0].val, tag };
    }
    return null;
  };
  const annual = new Map([...out.annual.income, ...out.annual.cashflow].map((row) => [row.code, row]));
  const quarterly = new Map([...out.statements.income, ...out.statements.cashflow].map((row) => [row.code, row]));
  out.years.forEach((year, y) => {
    const from = new Date(Date.parse(year.end) - 400 * DAY).toISOString().slice(0, 10);
    const splitInYear = (actions?.splits ?? []).some((split) => split.date > from && split.date <= (year.filed ?? year.end));
    for (const code of CHECK) {
      const row = annual.get(code);
      if (!row) continue;
      const count = (counts[code] ??= { years: 0, built: 0, compared: 0, match: 0, off: 0, over5: 0, over20: 0, splitYears: 0, splitMatch: 0 });
      count.years++;
      const sum = row.cells[y];
      if (!sum) continue;
      count.built++;
      const own = quarterly.get(code)?.cells[year.quarter]?.source ?? null;
      if (!UNIT[code] && (own === "derived" || own === null)) continue;
      const fact = annualFact(code, own, year.end);
      if (!fact) continue;
      count.compared++;
      // capital expenditure is stored negative in the standard and positive in the filings
      const filed = code === "capex" ? -Math.abs(fact.value) : fact.value;
      const tolerance = UNIT[code] === "USD/shares" ? Math.max(0.011, Math.abs(filed) * 0.005) : Math.abs(filed) * 0.005;
      const ok = Math.abs(sum.value - filed) <= tolerance;
      const relative = filed !== 0 ? Math.abs(sum.value - filed) / Math.abs(filed) : Infinity;
      if (ok) count.match++;
      else {
        count.off++;
        if (relative > 0.05) count.over5++;
        if (relative > 0.2) count.over20++;
        differences.push({ ticker: doc.ticker, cik: doc.cik, code, end: year.end, built: sum.value, filed, tag: fact.tag, splitInYear });
      }
      if (splitInYear && UNIT[code]) { count.splitYears++; if (ok) count.splitMatch++; }
    }
  });
}

console.log(`[check-desk-company-years] ${companies} companies · ${path.basename(source)}`);
console.table(Object.fromEntries(Object.entries(counts).map(([code, count]) => [code, { ...count, "match %": count.compared ? Math.round((1000 * count.match) / count.compared) / 10 : null }])));
console.log(`share counts and per-share figures checked for scale: ${checkedCells}; marked out of scale:`, marked);
const outFile = arg("--out");
if (outFile) writeFileSync(outFile, `${JSON.stringify({ source, counts, marked, checkedCells, differences }, null, 1)}\n`);
