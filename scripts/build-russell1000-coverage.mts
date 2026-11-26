/**
 * K27 F: former-member coverage from stored artifacts only. Requires B's final 909-company checkpoint and full K28.
 * Usage: npx tsx scripts/build-russell1000-coverage.mts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { corporateEndEvidence } from "../worker/lib/russell1000-coverage";
import { writeJsonAtomic } from "../worker/lib/json-file";

const root = "D:/research/alpha-engine";
const evidenceRoot = path.join(root, "index-membership/russell1000");
const eventsRoot = path.join(root, "engine/events");
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const evidence = (file: string) => ({ file, bytes: statSync(file).size, sha256: hash(file) });
const files = {
  companies: path.join(evidenceRoot, "companies.json"),
  facts: path.join(evidenceRoot, "k27-a-companyfacts.json"),
  cPilot: path.join(evidenceRoot, "k27-c-primary-pilot.json"),
  schwab: path.join(evidenceRoot, "k27-d-schwab-history.json"),
  stooq: path.join(evidenceRoot, "k27-e-stooq-coverage.json"),
  formerListed: path.join(evidenceRoot, "k27-former-listed-evidence.json"),
  bProgress: path.join(eventsRoot, "progress-r1000.json"),
  k28: path.join(root, "engine/flash-r1000/manifest.json"),
  globManifest: "worker/cache/companyfacts/manifest/1557860.json",
  globRaw: "worker/cache/companyfacts/1557860.json",
};
for (const [name, file] of Object.entries(files)) if (!existsSync(file)) throw new Error(`K27 F input is missing: ${name} ${file}`);
const bProgress = read<any>(files.bProgress);
if (bProgress.completedCompanies !== 909 || !bProgress.endTime) throw new Error("K27 F waits for B's final 909-company checkpoint");
const k28 = read<any>(files.k28);
const k28Errors = Array.isArray(k28.run?.errors) ? k28.run.errors.length : Number(k28.run?.errors ?? 0);
if (!k28.run?.processedReleases || k28Errors) throw new Error("K27 F waits for a complete, error-free full K28 manifest");

const companies = read<any>(files.companies).companies as any[];
const former = companies.filter(company => company.status === "former");
const facts = read<any>(files.facts).companies as any[];
const factsByCik = new Map(facts.map(row => [Number(row.cik), row]));
const glob = read<any>(files.globManifest);
if (glob.cik === 1557860 && glob.status === "refreshed") {
  const raw = read<any>(files.globRaw);
  let first: string | null = null, last: string | null = null, count = 0;
  for (const concepts of Object.values<any>(raw.facts ?? {})) for (const body of Object.values<any>(concepts)) for (const observations of Object.values<any>(body.units ?? {})) for (const row of observations as any[]) {
    count++;
    if (row.end) {
      first = !first || row.end < first ? row.end : first;
      last = !last || row.end > last ? row.end : last;
    }
  }
  factsByCik.set(1557860, { cik: 1557860, ticker: "GLOB", status: "refreshed", factsRows: count, ingestedRows: count - 1, excludedRows: 1, firstPeriod: first, lastPeriod: last, rawBytes: statSync(files.globRaw).size, rawSha256: glob.rawSha256, error: null });
}
const bByCik = new Map((bProgress.companies as any[]).map(row => [Number(row.cik), row]));
const cPilot = read<any>(files.cPilot).pilot.companies as any[];
const cByCik = new Map(cPilot.map(row => [Number(row.cik), row]));
const schwabByTicker = new Map((read<any>(files.schwab).companies as any[]).map(row => [String(row.ticker), row]));
const stooqByTicker = new Map((read<any>(files.stooq).companies as any[]).map(row => [String(row.ticker), row]));
const listedUniverse = read<any[]>("worker/edgar-universe-r1000-former-listed.json");
const listedTickers = new Map<number, string[]>();
for (const row of listedUniverse) listedTickers.set(row.cik, [...listedTickers.get(row.cik) ?? [], row.ticker]);
const listedEvidence = read<any>(files.formerListed);
const goneByCik = new Map((listedEvidence.gone as any[]).map(row => [Number(row.cik), row]));
const yahooRoot = path.join(root, "prices/yahoo/r1000-actions-2026-11-26T020001764Z");

function yahoo(ticker: string) {
  const file = path.join(yahooRoot, `${ticker}.json`);
  if (!existsSync(file)) return { ticker, status: "not found", dividends: null, splits: null, dividendsAtLimit: false, error: "No stored Yahoo answer" };
  const body = read<any>(file);
  const result = body.chart?.result?.[0];
  if (!result || body.chart?.error) return { ticker, status: "not found", dividends: null, splits: null, dividendsAtLimit: false, error: body.chart?.error ?? "No chart result" };
  return { ticker, status: "ok", dividends: Object.keys(result.events?.dividends ?? {}).length, splits: Object.keys(result.events?.splits ?? {}).length, dividendsAtLimit: ticker === "BMNP", error: null, sourceSha256: hash(file) };
}
function endEvidence(cik: number) {
  const mainFile = path.join(eventsRoot, "sec-submissions", `CIK${String(cik).padStart(10, "0")}.json`);
  if (!existsSync(mainFile)) return [];
  const main = read<any>(mainFile);
  const pages = [main];
  for (const file of main.filings?.files ?? []) {
    const page = path.join(eventsRoot, "sec-submissions", file.name);
    if (existsSync(page)) pages.push(read<any>(page));
  }
  return corporateEndEvidence(pages);
}

const rows = former.map(company => {
  const cik = Number(company.cik);
  const fact = factsByCik.get(cik);
  const b = bByCik.get(cik);
  const c = cByCik.get(cik);
  const tickers = listedTickers.get(cik) ?? company.tickers ?? [];
  const schwab = tickers.map(ticker => schwabByTicker.get(ticker) ?? { ticker, status: "not collected", candles: 0, error: "No current-listing Schwab target" });
  const stooq = tickers.map(ticker => stooqByTicker.get(ticker) ?? { ticker, present: false, sources: [] });
  const yahooRows = tickers.map(yahoo);
  const gone = goneByCik.get(cik);
  const missing: string[] = [], failures: string[] = [];
  if (!fact || fact.status === "failed") missing.push("A companyfacts");
  if (fact?.error) failures.push(`A: ${fact.error}`);
  if (!b) missing.push("B release calendar");
  if (b?.missingDocuments?.length) missing.push(`B ${b.missingDocuments.length} documents`);
  if (!c) missing.push("C primary documents (owner-skipped full run)");
  if (!schwab.some(row => row.candles > 0)) missing.push("D Schwab history");
  if (!stooq.some(row => row.present)) missing.push("E Stooq coverage");
  if (!yahooRows.some(row => row.status === "ok")) missing.push("E Yahoo actions");
  for (const row of schwab) if (row.error && row.candles === 0) failures.push(`D ${row.ticker}: ${row.error}`);
  for (const row of yahooRows) if (row.error) failures.push(`E ${row.ticker}: ${row.error}`);
  return {
    cik,
    name: company.name,
    tickers,
    status: gone ? "former-gone" : "former-listed",
    firstQuarter: company.firstQuarter,
    lastQuarter: company.lastQuarter,
    formerNames: company.formerNames,
    goneReason: gone?.reason ?? null,
    facts: fact ?? null,
    releases: b ? { filings: b.filings, quarters: b.quarters, releases: b.releases, completion: b.completion, missingDocuments: b.missingDocuments, pass: b.pass, issues: b.issues } : null,
    primaryDocuments: c ? { pilot: true, documents: c.documents, bytes: c.bytes, forms: c.forms } : { pilot: false, status: "not collected; full C skipped by the owner" },
    prices: { schwab, stooq, yahoo: yahooRows },
    corporateEndEvidence: endEvidence(cik),
    missing,
    failures,
  };
});
const summary = {
  companies: rows.length,
  formerListed: rows.filter(row => row.status === "former-listed").length,
  formerGone: rows.filter(row => row.status === "former-gone").length,
  factsSucceeded: rows.filter(row => row.facts && row.facts.status !== "failed").length,
  factsRows: rows.reduce((sum, row) => sum + (row.facts?.factsRows ?? 0), 0),
  releases: rows.reduce((sum, row) => sum + (row.releases?.releases ?? 0), 0),
  partialB: rows.filter(row => row.releases?.completion === "partial").length,
  primaryDocumentsPilot: rows.filter(row => row.primaryDocuments.pilot).length,
  schwabCompanies: rows.filter(row => row.prices.schwab.some(series => series.candles > 0)).length,
  stooqCompanies: rows.filter(row => row.prices.stooq.some(series => series.present)).length,
  yahooCompanies: rows.filter(row => row.prices.yahoo.some(series => series.status === "ok")).length,
  withCorporateEndEvidence: rows.filter(row => row.corporateEndEvidence.length).length,
  missingCounts: Object.fromEntries([...new Set(rows.flatMap(row => row.missing))].sort().map(reason => [reason, rows.filter(row => row.missing.includes(reason)).length])),
};
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary,
  earlyHistoryCondition: "Research using 2019-09 through 2020-02 must read K26 unmatched.json and report unmatched weight.",
  ownerC: "Full 10-K/10-Q collection skipped by the owner; the 20-company pilot is retained.",
  resumeCommands: {
    A: ["SEC_RPS=1 npx tsx worker/facts-fetch.mts --universe edgar-universe-r1000-new.json", "SEC_RPS=1 npx tsx worker/facts-fetch.mts --universe edgar-universe-r1000-former.json"],
    B: "SEC_RPS=1 npx tsx scripts/build-release-calendar-rest.mts --universe edgar-universe-r1000-new.json,edgar-universe-r1000-former.json --addendum r1000 --limit 909",
    C: "Skipped by owner; see k27-c-primary-pilot.json for the preserved command",
    D: "npx tsx worker/schwab-history-backfill.mts --universe edgar-universe-r1000-new.json,edgar-universe-r1000-former-listed.json --years 20 --out D:/research/alpha-engine/schwab/history-r1000 --min-interval-ms 1000",
    E: "Existing dated Yahoo folder and Stooq coverage evidence; no new Stooq download",
  },
  inputs: Object.values(files).map(evidence),
  companies: rows,
  productionWrite: false,
  databaseWrite: false,
};
const outputFile = path.join(evidenceRoot, "k27-f-coverage.json");
writeJsonAtomic(outputFile, output, true);
const markdown = [
  "# K27 F — former-member coverage", "",
  `Generated ${output.generatedAt}. Read-only stored evidence; no production or database write.`, "",
  `- Former companies: ${summary.companies} (${summary.formerListed} still listed, ${summary.formerGone} gone).`,
  `- A facts: ${summary.factsSucceeded}/${summary.companies}, ${summary.factsRows} rows. B releases: ${summary.releases}; partial companies: ${summary.partialB}.`,
  `- C primary documents: ${summary.primaryDocumentsPilot} pilot companies; all others not collected because the owner skipped full C.`,
  `- Schwab/Stooq/Yahoo company coverage: ${summary.schwabCompanies}/${summary.stooqCompanies}/${summary.yahooCompanies}.`,
  `- Companies with SEC Form 15/25 or merger-8-K evidence: ${summary.withCorporateEndEvidence}.`, "",
  "## Missing items", "",
  ...Object.entries(summary.missingCounts).map(([reason, count]) => `- ${reason}: ${count}`), "",
  "Every company, failure, source series and corporate-end accession is in `k27-f-coverage.json`. Early 2019-09..2020-02 research must report K26 unmatched weight.",
];
writeTextAtomic(path.join(evidenceRoot, "k27-f-coverage.md"), markdown.join("\n") + "\n");
console.log(JSON.stringify({ outputFile, markdown: path.join(evidenceRoot, "k27-f-coverage.md"), summary }, null, 1));

function writeTextAtomic(file: string, body: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
