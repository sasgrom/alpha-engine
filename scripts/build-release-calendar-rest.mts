import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { buildQuarters, type CalendarFiling, type CalendarQuarter } from "../worker/lib/event-calendar";
import { calendarRowsFromSubmissions, companyPilotChecks, parseIndexAcceptanceEt, projectRestRun, seededQuarterSample, type ExhibitOutcome, type RestCompany } from "../worker/lib/event-calendar-rest";
import { fetchDoc, isPermanentSecMissing, listFilingDocs, realCacheRoot, secGet } from "../worker/lib/edgar";
import { exhibitCacheName, selectSubstantiveExhibits } from "../worker/lib/exhibits";
import { writeJsonAtomic } from "../worker/lib/json-file";

const outputRoot = path.resolve("D:/research/alpha-engine/engine/events");
const cacheRoot = path.resolve("worker/cache/edgar");
const universeFile = path.join(outputRoot, "universe-rest.json");
const filingsFile = path.join(outputRoot, "filings-rest.jsonl");
const quartersFile = path.join(outputRoot, "quarters-rest.jsonl");
const progressFile = path.join(outputRoot, "progress-rest.json");
const manifestFile = path.join(outputRoot, "manifest-rest.json");
const summaryFile = "research/engine/event-calendar-rest.summary.json";
const minimumFreeBytes = 100 * 2 ** 30;
const maximumExhibitBytes = 50 * 1024 * 1024;
const startedAt = new Date().toISOString();
const wallStarted = Date.now();
const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const codeFiles = [
  "scripts/build-event-calendar.mts",
  "scripts/build-release-calendar-rest.mts",
  "worker/lib/edgar.ts",
  "worker/lib/event-calendar-options.ts",
  "worker/lib/event-calendar-rest.ts",
  "worker/lib/event-calendar.ts",
  "worker/lib/exhibits.ts",
  "worker/lib/json-file.ts",
];
const codeHash = createHash("sha256");
for (const file of codeFiles.slice().sort()) codeHash.update(file).update("\0").update(readFileSync(file));
const codeFingerprint = codeHash.digest("hex");
const research50Expected = {
  filings: "29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d",
  quarters: "35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f",
};

interface CompanyResult {
  cik: number;
  ticker: string;
  filings: CalendarFiling[];
  quarters: CalendarQuarter[];
  outcomes: ExhibitOutcome[];
  checks: ReturnType<typeof companyPilotChecks>;
  bytesDownloaded: number;
  bytesOnDisk: number;
  elapsedSeconds: number;
}

interface CompanyCheckpoint {
  schemaVersion: 1;
  codeHash: string;
  cik: number;
  inputSha256: string;
  cacheable: boolean;
  result: CompanyResult;
}

function hashBytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(file: string): string {
  return hashBytes(readFileSync(file));
}

function readJsonIfExists<T>(file: string): T | null {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : null;
}

function writeTextAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, file);
  } catch (error) {
    throw new Error(`Write failed for ${file}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function artifact(file: string) {
  return { path: file, bytes: statSync(file).size, sha256: hashFile(file) };
}

function assertStorage(): void {
  if (process.platform === "win32" && !/^d:/i.test(outputRoot)) throw new Error(`REST output must stay on D:, got ${outputRoot}`);
  const cacheStats = statfsSync(realCacheRoot(path.resolve("worker/cache")));
  const outputStats = statfsSync(outputRoot);
  if (cacheStats.bavail * cacheStats.bsize < minimumFreeBytes || outputStats.bavail * outputStats.bsize < minimumFreeBytes) {
    throw new Error("Free D: space is below 100 GiB; completed company checkpoints are preserved");
  }
}

mkdirSync(outputRoot, { recursive: true });
assertStorage();

let throttledSince: number | null = null;
async function secCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    throttledSince = null;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 429/i.test(message)) {
      throttledSince ??= Date.now();
      if (Date.now() - throttledSince >= 15 * 60 * 1000) throw new Error("SEC throttling persisted for more than 15 minutes; pilot stopped");
    }
    throw error;
  }
}

async function cachedSecJson(url: string, file: string): Promise<{ value: any; raw: string }> {
  if (existsSync(file)) return { value: JSON.parse(readFileSync(file, "utf8")), raw: readFileSync(file, "utf8") };
  const response = await secCall(() => secGet(url));
  const raw = await response.text();
  const value = JSON.parse(raw);
  writeTextAtomic(file, raw);
  return { value, raw };
}

async function submissions(cik: number): Promise<{ pages: any[]; inputSha256: string }> {
  const directory = path.join(outputRoot, "sec-submissions");
  const padded = String(cik).padStart(10, "0");
  const main = await cachedSecJson(`https://data.sec.gov/submissions/CIK${padded}.json`, path.join(directory, `CIK${padded}.json`));
  const pages = [main.value.filings?.recent ?? {}];
  const hashes = [{ name: `CIK${padded}.json`, raw: main.raw }];
  for (const file of main.value.filings?.files ?? []) {
    const page = await cachedSecJson(`https://data.sec.gov/submissions/${file.name}`, path.join(directory, file.name));
    pages.push(page.value);
    hashes.push({ name: file.name, raw: page.raw });
  }
  return { pages, inputSha256: hashBytes(JSON.stringify(hashes)) };
}

function distribution(values: CalendarFiling[], key: "form" | "year" | "basis") {
  const output: Record<string, Record<string, number>> = {};
  for (const row of values) {
    const group = key === "form" ? row.form : key === "year" ? row.filingDate.slice(0, 4) : row.earningsFlagBasis;
    output[group] ??= {};
    output[group][row.form] = (output[group][row.form] ?? 0) + 1;
  }
  return output;
}

function cachedFileMap(cik: number): Map<string, { name: string; bytes: number }[]> {
  const output = new Map<string, { name: string; bytes: number }[]>();
  const directory = path.join(cacheRoot, String(cik));
  if (!existsSync(directory)) return output;
  for (const name of readdirSync(directory)) {
    const match = name.match(/^(\d{18})(?:\.htm|\.ex.*\.htm)$/);
    if (!match) continue;
    const base = match[1];
    if (!(name === `${base}.htm` || (name.startsWith(`${base}.ex`) && name.endsWith(".htm")))) continue;
    output.set(base, [...(output.get(base) ?? []), { name, bytes: statSync(path.join(directory, name)).size }]);
  }
  for (const [base, files] of output) output.set(base, files.sort((a, b) => a.name.localeCompare(b.name)));
  return output;
}

function validExhibitFiles(cik: number, accessionNo: string, files: { name: string; size: number; sha256: string }[]): boolean {
  return files.every((file) => {
    try {
      const target = path.join(cacheRoot, String(cik), exhibitCacheName(accessionNo, file.name));
      const bytes = readFileSync(target);
      return bytes.length === file.size && hashBytes(bytes) === file.sha256;
    } catch {
      return false;
    }
  });
}

function manifestOutcome(cik: number, entry: any): ExhibitOutcome | null {
  const status = entry.releaseExhibitStatus as ExhibitOutcome["status"] | undefined;
  if (!status) return null;
  const files = (entry.exhibitFiles ?? []).map((file: any) => ({ name: String(file.name), size: Number(file.size), sha256: String(file.sha256) }));
  if (status === "complete" && (!files.length || !validExhibitFiles(cik, entry.accessionNo, files))) return null;
  const reason = entry.releaseExhibitReason ? String(entry.releaseExhibitReason) : null;
  if (status !== "complete" && !reason) return null;
  return { accessionNo: entry.accessionNo, status, files, reason, bytesDownloaded: 0 };
}

async function downloadRelease(cik: number, filing: CalendarFiling, entry: any): Promise<ExhibitOutcome> {
  const resumed = manifestOutcome(cik, entry);
  if (resumed) return resumed;
  try {
    const docs = await secCall(() => listFilingDocs(cik, filing.accessionNo));
    const selected = selectSubstantiveExhibits(docs, filing.primaryDoc);
    const bytes = selected.reduce((total, doc) => total + doc.size, 0);
    if (bytes > maximumExhibitBytes) return { accessionNo: filing.accessionNo, status: "error", files: [], reason: `EX-99 set exceeds 50 MiB safety limit (${bytes} bytes)`, bytesDownloaded: 0 };
    if (!selected.length) return { accessionNo: filing.accessionNo, status: "no_exhibit", files: [], reason: "No substantive earnings exhibit in the filing index", bytesDownloaded: 0 };
    const files: ExhibitOutcome["files"] = [];
    let bytesDownloaded = 0;
    for (const doc of selected) {
      const target = path.join(cacheRoot, String(cik), exhibitCacheName(filing.accessionNo, doc.name));
      let text: string;
      if (existsSync(target)) text = readFileSync(target, "utf8");
      else {
        text = await secCall(() => fetchDoc(cik, filing.accessionNo, doc.name));
        writeTextAtomic(target, text);
        bytesDownloaded += Buffer.byteLength(text);
      }
      files.push({ name: doc.name, size: Buffer.byteLength(text), sha256: hashBytes(text) });
      assertStorage();
    }
    return { accessionNo: filing.accessionNo, status: "complete", files: files.sort((a, b) => a.name.localeCompare(b.name)), reason: null, bytesDownloaded };
  } catch (error) {
    if (isPermanentSecMissing(error)) return { accessionNo: filing.accessionNo, status: "error", files: [], reason: String(error).slice(0, 300), bytesDownloaded: 0 };
    throw error;
  }
}

function mergeManifest(cik: number, filings: CalendarFiling[]): { file: string; rows: any[]; byAccession: Map<string, any> } {
  const file = path.join(cacheRoot, String(cik), "manifest.json");
  const rows = readJsonIfExists<any[]>(file) ?? [];
  const byAccession = new Map(rows.map((row) => [row.accessionNo, row]));
  for (const filing of filings) {
    if (byAccession.has(filing.accessionNo)) continue;
    const entry = {
      accessionNo: filing.accessionNo,
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate ?? "",
      primaryDoc: filing.primaryDoc ?? "",
      eventTs: filing.acceptedEt?.replace("T", " ") ?? "",
      docName: filing.primaryDoc,
      fetched: false,
      scored: false,
    };
    rows.push(entry);
    byAccession.set(filing.accessionNo, entry);
  }
  return { file, rows, byAccession };
}

async function processCompany(company: RestCompany): Promise<{ result: CompanyResult; resumed: boolean }> {
  const companyStarted = Date.now();
  assertStorage();
  const source = await submissions(company.cik);
  const checkpointFile = path.join(outputRoot, "rest-companies", `${company.cik}.json`);
  const checkpoint = readJsonIfExists<CompanyCheckpoint>(checkpointFile);
  const inheritedBytesDownloaded = checkpoint?.result.bytesDownloaded ?? 0;
  const inheritedElapsedSeconds = checkpoint?.result.elapsedSeconds ?? 0;
  if (checkpoint && checkpoint.schemaVersion === 1 && checkpoint.codeHash === codeFingerprint && checkpoint.cik === company.cik && checkpoint.inputSha256 === hashBytes(JSON.stringify({ submissions: source.inputSha256, spyDates })) && checkpoint.cacheable && checkpoint.result.cik === company.cik && checkpoint.result.outcomes.every((outcome) => outcome.status !== "complete" || (outcome.files.length > 0 && validExhibitFiles(company.cik, outcome.accessionNo, outcome.files)))) {
    return { result: checkpoint.result, resumed: true };
  }
  const filings = calendarRowsFromSubmissions(company, source.pages);
  const manifest = mergeManifest(company.cik, filings);
  const outcomes: ExhibitOutcome[] = [];
  let bytesDownloaded = 0;
  for (const filing of filings.filter((row) => row.isEarningsRelease === true)) {
    const entry = manifest.byAccession.get(filing.accessionNo);
    const outcome = await downloadRelease(company.cik, filing, entry);
    outcomes.push(outcome);
    bytesDownloaded += outcome.bytesDownloaded;
    entry.exhibitFiles = outcome.files;
    entry.exhibitsComplete = outcome.status === "complete";
    entry.releaseExhibitStatus = outcome.status;
    entry.releaseExhibitReason = outcome.reason;
    writeJsonAtomic(manifest.file, manifest.rows, true);
  }
  const cachedFiles = cachedFileMap(company.cik);
  for (const filing of filings) filing.cachedFiles = cachedFiles.get(filing.accessionNo.replaceAll("-", "")) ?? [];
  const quarters = buildQuarters(filings, spyDates);
  const checks = companyPilotChecks(filings, quarters, outcomes);
  const result: CompanyResult = {
    cik: company.cik,
    ticker: company.ticker,
    filings,
    quarters,
    outcomes,
    checks,
    bytesDownloaded: inheritedBytesDownloaded + bytesDownloaded,
    bytesOnDisk: outcomes.reduce((total, outcome) => total + outcome.files.reduce((sum, file) => sum + file.size, 0), 0),
    elapsedSeconds: inheritedElapsedSeconds + (Date.now() - companyStarted) / 1000,
  };
  writeJsonAtomic(checkpointFile, { schemaVersion: 1, codeHash: codeFingerprint, cik: company.cik, inputSha256: hashBytes(JSON.stringify({ submissions: source.inputSha256, spyDates })), cacheable: true, result } satisfies CompanyCheckpoint, true);
  return { result, resumed: false };
}

const previousProgress = readJsonIfExists<any>(progressFile);
let universeEvidence = previousProgress?.universeEvidence ?? null;
let universe: RestCompany[] = [];
let spyDates: string[] = [];
const db = getDb();
try {
  const existingUniverse = readJsonIfExists<RestCompany[]>(universeFile);
  if (!existingUniverse || !universeEvidence) {
    const research50 = new Set((JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number }[]).map((row) => Number(row.cik)));
    const [factRows]: any = await db.execute(sql`SELECT c.cik, c.ticker, c.name, fc.factRows, pc.priceRows FROM companies c JOIN (SELECT cik, COUNT(*) factRows FROM facts GROUP BY cik) fc ON fc.cik=c.cik LEFT JOIN (SELECT cik, COUNT(*) priceRows FROM prices WHERE source="stooq" GROUP BY cik) pc ON pc.cik=c.cik ORDER BY fc.factRows DESC, c.cik`);
    const [priceRows]: any = await db.execute(sql`SELECT p.cik, p.ticker, COUNT(*) priceRows, MAX(c.name) name, MAX(f.factRows) factRows FROM (SELECT cik,ticker FROM prices WHERE source="stooq" GROUP BY cik,ticker) p LEFT JOIN companies c ON c.cik=p.cik LEFT JOIN (SELECT cik,COUNT(*) factRows FROM facts GROUP BY cik) f ON f.cik=p.cik WHERE p.cik>0 GROUP BY p.cik,p.ticker ORDER BY p.cik`);
    const factCompanies = factRows.filter((row: any) => !research50.has(Number(row.cik)));
    const eligible = factCompanies.filter((row: any) => Number(row.priceRows) > 0);
    universe = eligible.map((row: any) => ({ cik: Number(row.cik), ticker: String(row.ticker), name: String(row.name) }));
    universeEvidence = {
      factCompanies: factRows.length,
      eligibleCompanies: universe.length,
      factsWithoutStooq: factCompanies.filter((row: any) => !Number(row.priceRows)).map((row: any) => ({ cik: Number(row.cik), ticker: String(row.ticker), factRows: Number(row.factRows) })),
      pricesWithoutFacts: priceRows.filter((row: any) => !research50.has(Number(row.cik)) && !Number(row.factRows)).map((row: any) => ({ cik: Number(row.cik), ticker: String(row.ticker), priceRows: Number(row.priceRows) })),
    };
    writeJsonAtomic(universeFile, universe, true);
  } else {
    universe = existingUniverse;
  }
  const [spyRows]: any = await db.execute(sql`SELECT DISTINCT date FROM prices WHERE cik=0 AND source="stooq" ORDER BY date`);
  spyDates = spyRows.map((row: any) => String(row.date).slice(0, 10));
} finally {
  await db.$client.end();
}

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const limit = Number(option("--limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > universe.length) throw new Error(`--limit must be an integer from 1 to ${universe.length}`);
const pilotUniverse = universe.slice(0, limit);
const results: CompanyResult[] = [];
let cacheHits = 0;
let processedThisRun = 0;
let endTime: string | null = null;

function writeOutputs(status: string, indexChecks: any): void {
  const filings = results.flatMap((result) => result.filings);
  const quarters = results.flatMap((result) => result.quarters);
  const outcomes = results.flatMap((result) => result.outcomes);
  writeTextAtomic(filingsFile, jsonl(filings));
  writeTextAtomic(quartersFile, jsonl(quarters));
  const overall = companyPilotChecks(filings, quarters, outcomes);
  const bytesDownloaded = results.reduce((total, result) => total + result.bytesDownloaded, 0);
  const bytesOnDisk = results.reduce((total, result) => total + result.bytesOnDisk, 0);
  const elapsedSeconds = results.reduce((total, result) => total + result.elapsedSeconds, 0);
  const freeBytes = statfsSync(outputRoot).bavail * statfsSync(outputRoot).bsize;
  const projection = projectRestRun({ eligibleCompanies: universe.length, pilotCompanies: results.length, bytesDownloaded: bytesOnDisk, elapsedSeconds, freeBytes });
  const research50 = {
    filings: { ...artifact(path.join(outputRoot, "filings-50.jsonl")), expectedSha256: research50Expected.filings },
    quarters: { ...artifact(path.join(outputRoot, "quarters-50.jsonl")), expectedSha256: research50Expected.quarters },
  };
  const research50Pass = research50.filings.sha256 === research50Expected.filings && research50.quarters.sha256 === research50Expected.quarters;
  const indexPass = indexChecks.total === 30 && indexChecks.matched === 30 && indexChecks.failed === 0;
  const companyPass = results.every((result) => result.checks.pass);
  const overallPass = status === "pilot_complete" && overall.pass && companyPass && indexPass && research50Pass && projection.storagePass;
  const finalStatus = status === "pilot_complete" && !overallPass ? "pilot_failed" : status;
  if (status === "pilot_complete") endTime = new Date().toISOString();
  const progress = {
    schemaVersion: 1,
    status: finalStatus,
    startedAt: previousProgress?.startedAt ?? startedAt,
    lastCompletedAt: results.length ? new Date().toISOString() : null,
    endTime,
    codeCommit,
    codeHash: codeFingerprint,
    eligibleCompanies: universe.length,
    completedCompanies: results.length,
    universeEvidence,
    companies: results.map((result) => ({ cik: result.cik, ticker: result.ticker, filings: result.filings.length, quarters: result.quarters.length, releases: result.outcomes.length, bytesDownloaded: result.bytesDownloaded, bytesOnDisk: result.bytesOnDisk, elapsedSeconds: result.elapsedSeconds, pass: result.checks.pass, issues: result.checks.issues })),
  };
  writeJsonAtomic(progressFile, progress, true);
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: finalStatus,
    codeCommit,
    codeHash: codeFingerprint,
    eligibleCompanies: universe.length,
    pilotCompanies: limit,
    completedCompanies: results.length,
    counts: {
      filings: filings.length,
      quarters: quarters.length,
      releases: outcomes.length,
      bytesDownloaded,
      bytesOnDisk,
      elapsedSeconds,
      cacheHits,
      processedThisRun,
      wallSecondsThisRun: (Date.now() - wallStarted) / 1000,
    },
    overall: { ...overall, pass: overallPass },
    companies: Object.fromEntries(results.map((result) => [result.ticker, result.checks])),
    countsByForm: distribution(filings, "form"),
    countsByYear: distribution(filings, "year"),
    earningsByBasis: distribution(filings.filter((row) => row.isEarningsRelease === true), "basis"),
    exhibitExceptions: results.flatMap((result) => result.outcomes.filter((outcome) => outcome.files.length === 0).map((outcome) => ({ cik: result.cik, ticker: result.ticker, accessionNo: outcome.accessionNo, status: outcome.status, reason: outcome.reason }))),
    indexChecks,
    research50: { ...research50, pass: research50Pass },
    projection,
    universeEvidence,
    artifacts: { universe: artifact(universeFile), filings: artifact(filingsFile), quarters: artifact(quartersFile) },
    productionWrite: false,
    databaseWrite: false,
  };
  writeJsonAtomic(summaryFile, summary, true);
  const manifest = {
    schemaVersion: 1,
    generatedAt: summary.generatedAt,
    startedAt: progress.startedAt,
    endTime,
    status: finalStatus,
    codeCommit,
    codeHash: codeFingerprint,
    counts: summary.counts,
    projection,
    artifacts: { ...summary.artifacts, progress: artifact(progressFile), summary: artifact(summaryFile) },
    productionWrite: false,
    databaseWrite: false,
  };
  writeJsonAtomic(manifestFile, manifest, true);
  console.log(JSON.stringify({ status: finalStatus, completed: results.length, filings: filings.length, quarters: quarters.length, releases: outcomes.length, bytesDownloaded, bytesOnDisk, cacheHits, processedThisRun, indexChecks: { total: indexChecks.total, matched: indexChecks.matched, failed: indexChecks.failed }, projection, overallPass }, null, 2));
}

for (const company of pilotUniverse) {
    const { result, resumed } = await processCompany(company);
    results.push(result);
    if (resumed) cacheHits++;
    else processedThisRun++;
    console.log(`[rest] ${company.ticker}: ${result.filings.length} filings, ${result.quarters.length} quarters, ${result.outcomes.length} releases, ${result.bytesDownloaded} new bytes, resumed=${resumed}, checks=${result.checks.pass ? "pass" : result.checks.issues.join("; ")}`);
    writeOutputs("running", { total: 0, matched: 0, failed: 0, rows: [] });
  }
  const selected = seededQuarterSample(results.flatMap((result) => result.quarters), 30, "K06-2026-11-11");
  const indexRows = [];
  for (const quarter of selected) {
    const cik = quarter.cik;
    const accessionNo = quarter.earningsAccession!;
    const evidenceFile = path.join(outputRoot, "index-checks-rest", `${cik}-${accessionNo}.json`);
    let evidence = readJsonIfExists<any>(evidenceFile);
    if (!evidence || evidence.codeHash !== codeFingerprint || evidence.expectedEt !== quarter.earningsAcceptedEt) {
      try {
        const html = await secCall(() => fetchDoc(cik, accessionNo, `${accessionNo}-index.html`));
        evidence = { codeHash: codeFingerprint, accessionNo, acceptedEt: parseIndexAcceptanceEt(html), expectedEt: quarter.earningsAcceptedEt, source: "sec_index_page" };
        writeJsonAtomic(evidenceFile, evidence, true);
      } catch (error) {
        evidence = { accessionNo, error: String(error).slice(0, 300), expectedEt: quarter.earningsAcceptedEt, source: "sec_index_page" };
      }
    }
    indexRows.push({ cik, ...evidence, match: evidence.acceptedEt === quarter.earningsAcceptedEt });
  }
  const indexChecks = { total: indexRows.length, matched: indexRows.filter((row) => row.match).length, failed: indexRows.filter((row) => !row.match).length, rows: indexRows };
  writeOutputs("pilot_complete", indexChecks);
  const finalSummary = JSON.parse(readFileSync(summaryFile, "utf8"));
  if (!finalSummary.overall.pass) process.exitCode = 1;
