/**
 * Where the covered companies have their headquarters, for the map table of the fund-flow hall: the state (or the
 * country) of each company's business address in its SEC submissions record (data.sec.gov, through the worker's
 * fair-access client). EDGAR keeps only today's address, so a company that moved shows where it is now.
 *
 * Reads the companies from the built fund-flow overview (worker/.runs/desk-flows/overview.json) and writes
 * research/engine/company-headquarters.json. Companies already in the file are kept unless --refresh is given.
 *
 *   npx tsx scripts/build-company-headquarters.mts
 *   npx tsx scripts/build-company-headquarters.mts --refresh
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secGet } from "../worker/lib/edgar";

interface Headquarters { cik: number; ticker: string; name: string; city: string | null; state: string | null; place: string | null }

const OUT = path.resolve("research/engine/company-headquarters.json");
const OVERVIEW = path.resolve("worker/.runs/desk-flows/overview.json");
const refresh = process.argv.includes("--refresh");

const overview = JSON.parse(readFileSync(OVERVIEW, "utf8")) as { companies: { cik: number; ticker: string; name: string }[] };
const kept = new Map<number, Headquarters>();
if (existsSync(OUT) && !refresh) for (const row of (JSON.parse(readFileSync(OUT, "utf8")) as { companies: Headquarters[] }).companies) kept.set(row.cik, row);

const rows: Headquarters[] = [];
const failed: { cik: number; ticker: string; error: string }[] = [];
let fetched = 0;
for (const company of overview.companies) {
  const known = kept.get(company.cik);
  if (known) {
    rows.push(known);
    continue;
  }
  try {
    const record = (await (await secGet(`https://data.sec.gov/submissions/CIK${String(company.cik).padStart(10, "0")}.json`)).json()) as {
      addresses?: Record<string, { city?: string | null; stateOrCountry?: string | null; stateOrCountryDescription?: string | null } | undefined>;
    };
    // the business address; the mailing address only when a filer gives no business address
    const address = record.addresses?.business?.stateOrCountry ? record.addresses.business : record.addresses?.mailing;
    rows.push({ cik: company.cik, ticker: company.ticker, name: company.name, city: address?.city ?? null, state: address?.stateOrCountry ?? null, place: address?.stateOrCountryDescription ?? null });
    fetched++;
  } catch (error) {
    failed.push({ cik: company.cik, ticker: company.ticker, error: String(error).slice(0, 200) });
  }
}
rows.sort((a, b) => a.cik - b.cik);
const file = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "SEC EDGAR submissions (data.sec.gov/submissions), business address (mailing address when no business address); today's address only",
  companies: rows,
  failed,
};
const temporary = `${OUT}.tmp`;
writeFileSync(temporary, `${JSON.stringify(file, null, 1)}\n`);
renameSync(temporary, OUT);
const states = new Map<string, number>();
for (const row of rows) states.set(row.state ?? "?", (states.get(row.state ?? "?") ?? 0) + 1);
console.log(`[headquarters] ${rows.length} companies (${fetched} fetched, ${rows.length - fetched} kept), ${failed.length} failed · ${[...states].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([state, count]) => `${state} ${count}`).join(", ")} · ${OUT}`);
if (failed.length) process.exitCode = 1;
