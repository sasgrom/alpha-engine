/**
 * Fetches 13F reports into the local cache only, for funds added to the fund books (owner, 2026-11-26: "go ahead with
 * the famous people data"). No database write (scripts/13f-refresh.mts also writes fund_holdings and signals; the books
 * read the cache, not that table).
 *
 *   SEC_RPS=4 npx tsx scripts/fetch-13f-cache.mts --ciks 1649339,1536411 [--since 2020-06-30]
 *
 * Per fund, every 13F-HR and 13F-HR/A whose report date is on or after --since: the information table (the largest XML
 * document of the filing) as worker/cache/13f/<cik>/<accession>.xml and the cover page as <accession>.primary.xml, the
 * same layout as 13f-refresh. A file already in the cache is never fetched again; files are written whole (temp file,
 * then rename), so a stop never leaves half a table behind.
 */
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchDoc, listFilingDocs, listFilings } from "../worker/lib/edgar";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const ciks = (arg("--ciks") ?? "").split(",").map(Number).filter(Boolean);
const since = arg("--since") ?? "2020-06-30";
if (!ciks.length) throw new Error("--ciks is required");
const CACHE = path.resolve("worker/cache/13f");
if (!existsSync(CACHE) || !/^d:/i.test(realpathSync(CACHE))) throw new Error("The 13F cache must exist and resolve to D: (the drive may be away); nothing was fetched");
const FORMS = new Set(["13F-HR", "13F-HR/A"]);

function save(file: string, body: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, body);
  renameSync(`${file}.part`, file);
}

const summary: { cik: number; filings: number; fetched: number; skipped: number; failed: string[] }[] = [];
for (const cik of ciks) {
  const row = { cik, filings: 0, fetched: 0, skipped: 0, failed: [] as string[] };
  summary.push(row);
  let filings;
  try { filings = (await listFilings(cik, FORMS)).filter((filing) => (filing.reportDate || filing.filingDate) >= since); }
  catch (error) { row.failed.push(`list: ${String((error as Error).message).slice(0, 80)}`); continue; }
  row.filings = filings.length;
  for (const filing of filings) {
    const base = path.join(CACHE, String(cik), filing.accessionNo.replace(/-/g, ""));
    try {
      if (existsSync(`${base}.xml`)) row.skipped++;
      else {
        const docs = (await listFilingDocs(cik, filing.accessionNo)).filter((doc) => /\.xml$/i.test(doc.name) && doc.name !== "primary_doc.xml");
        const table = docs.sort((a, b) => b.size - a.size)[0];
        if (!table) { row.failed.push(`${filing.accessionNo}: no XML table`); continue; }
        save(`${base}.xml`, await fetchDoc(cik, filing.accessionNo, table.name));
        row.fetched++;
      }
      if (!existsSync(`${base}.primary.xml`)) save(`${base}.primary.xml`, await fetchDoc(cik, filing.accessionNo, "primary_doc.xml"));
    } catch (error) {
      row.failed.push(`${filing.accessionNo}: ${String((error as Error).message).slice(0, 80)}`);
    }
  }
  console.log(`${cik}: ${row.filings} filings since ${since}, fetched ${row.fetched}, already cached ${row.skipped}${row.failed.length ? `, failed ${row.failed.length}: ${row.failed.slice(0, 2).join(" | ")}` : ""}`);
}
const failed = summary.reduce((sum, row) => sum + row.failed.length, 0);
console.log(`done: ${summary.length} funds, ${summary.reduce((sum, row) => sum + row.fetched, 0)} tables fetched, ${failed} failed`);
process.exit(failed ? 1 : 0);
