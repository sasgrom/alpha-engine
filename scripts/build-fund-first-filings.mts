/**
 * How long each tracked 13F filer has been on EDGAR: the date of its first electronic filing, from its SEC
 * submissions record (data.sec.gov, through the worker's fair-access client). The hall uses it as the age of the
 * firm's figure (older firms older people). EDGAR's electronic records begin in 1993-1996, so every firm filing
 * since then shows that floor, not its founding.
 *
 * Reads the funds from the built fund-flow overview (worker/.runs/desk-flows/overview.json) and writes
 * research/engine/fund-first-filings.json. Funds already in the file are kept unless --refresh is given.
 *
 *   npx tsx scripts/build-fund-first-filings.mts
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secGet } from "../worker/lib/edgar";

interface FirstFiling { cik: number; name: string; firstFiling: string | null; formerNames: string[] }

const OUT = path.resolve("research/engine/fund-first-filings.json");
const OVERVIEW = path.resolve("worker/.runs/desk-flows/overview.json");
const refresh = process.argv.includes("--refresh");

const overview = JSON.parse(readFileSync(OVERVIEW, "utf8")) as { funds: { cik: number; name: string }[] };
const kept = new Map<number, FirstFiling>();
if (existsSync(OUT) && !refresh) for (const row of (JSON.parse(readFileSync(OUT, "utf8")) as { funds: FirstFiling[] }).funds) kept.set(row.cik, row);

type Block = { filingDate?: string[] } | undefined;
const earliest = (dates: string[] | undefined) => (dates ?? []).reduce<string | null>((min, date) => (date && (!min || date < min) ? date : min), null);

const rows: FirstFiling[] = [];
const failed: { cik: number; error: string }[] = [];
for (const fund of overview.funds) {
  const known = kept.get(fund.cik);
  if (known) {
    rows.push(known);
    continue;
  }
  try {
    const record = (await (await secGet(`https://data.sec.gov/submissions/CIK${String(fund.cik).padStart(10, "0")}.json`)).json()) as {
      formerNames?: { name: string }[];
      filings?: { recent?: Block; files?: { filingFrom?: string }[] };
    };
    // the oldest page of the archive says where the record begins; otherwise the oldest recent filing
    const fromFiles = (record.filings?.files ?? []).reduce<string | null>((min, file) => (file.filingFrom && (!min || file.filingFrom < min) ? file.filingFrom : min), null);
    const fromRecent = earliest(record.filings?.recent?.filingDate);
    const first = [fromFiles, fromRecent].filter((date): date is string => Boolean(date)).sort()[0] ?? null;
    rows.push({ cik: fund.cik, name: fund.name, firstFiling: first, formerNames: (record.formerNames ?? []).map((entry) => entry.name) });
  } catch (error) {
    failed.push({ cik: fund.cik, error: String(error).slice(0, 200) });
  }
}
rows.sort((a, b) => a.cik - b.cik);
const temporary = `${OUT}.tmp`;
writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), source: "SEC EDGAR submissions (data.sec.gov/submissions): date of the first electronic filing; EDGAR's records begin in 1993-1996", funds: rows, failed }, null, 1)}\n`);
renameSync(temporary, OUT);
const decades = new Map<string, number>();
for (const row of rows) decades.set(row.firstFiling ? `${row.firstFiling.slice(0, 3)}0s` : "?", (decades.get(row.firstFiling ? `${row.firstFiling.slice(0, 3)}0s` : "?") ?? 0) + 1);
console.log(`[first-filings] ${rows.length} funds, ${failed.length} failed · ${[...decades].sort().map(([decade, count]) => `${decade} ${count}`).join(", ")} · ${OUT}`);
if (failed.length) process.exitCode = 1;
