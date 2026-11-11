import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { fetchDoc, secGet } from "../worker/lib/edgar";
import { acceptanceEt, acceptanceChecks, acceptanceUtc, buildQuarters, earningsFlag, type CalendarFiling } from "../worker/lib/event-calendar";
import { writeJsonAtomic } from "../worker/lib/json-file";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const outputRoot = path.resolve("D:/research/alpha-engine/engine/events");
mkdirSync(outputRoot, { recursive: true });

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
function writeJsonl(file: string, rows: unknown[]): void {
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
async function secJson(cik: number): Promise<any> {
  const directory = path.join(outputRoot, "sec-submissions");
  mkdirSync(directory, { recursive: true });
  const padded = String(cik).padStart(10, "0");
  const mainFile = path.join(directory, `CIK${padded}.json`);
  let main = readJson<any>(mainFile, null);
  if (!main) {
    const response = await secGet(`https://data.sec.gov/submissions/CIK${padded}.json`);
    main = await response.json();
    writeFileSync(mainFile, JSON.stringify(main, null, 1));
  }
  const pages: any[] = [main.filings?.recent ?? {}];
  for (const file of main.filings?.files ?? []) {
    const pageFile = path.join(directory, file.name);
    let page = readJson<any>(pageFile, null);
    if (!page) {
      const response = await secGet(`https://data.sec.gov/submissions/${file.name}`);
      page = await response.json();
      writeFileSync(pageFile, JSON.stringify(page, null, 1));
    }
    pages.push(page);
  }
  const metadata = new Map<string, any>();
  for (const page of pages) {
    for (let index = 0; index < (page.accessionNumber?.length ?? 0); index++) {
      const accessionNo = String(page.accessionNumber[index]);
      if (!metadata.has(accessionNo)) metadata.set(accessionNo, {
        acceptanceDateTime: page.acceptanceDateTime?.[index],
        items: page.items?.[index] || null,
        primaryDocument: page.primaryDocument?.[index] || null,
        reportDate: page.reportDate?.[index] || null,
      });
    }
  }
  return metadata;
}

function cachedFiles(cik: number, accessionNo: string) {
  const directory = path.resolve(`D:/alpha-engine/worker/cache/edgar/${cik}`);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name === `${accessionNo}.htm` || (name.startsWith(`${accessionNo}.ex`) && name.endsWith(".htm"))).map((name) => ({ name, bytes: statSync(path.join(directory, name)).size })).sort((a, b) => a.name.localeCompare(b.name));
}

function primaryText(cik: number, accessionNo: string, primaryDoc: string | null): string | null {
  const directory = path.resolve(`D:/alpha-engine/worker/cache/edgar/${cik}`);
  const candidates = [`${accessionNo}.htm`, primaryDoc].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const file = path.join(directory, candidate);
    if (existsSync(file)) {
      try { return readFileSync(file, "utf8"); } catch { return null; }
    }
  }
  return null;
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

const db = getDb();
try {
  const ciks = universe.map((company) => company.cik);
  const [localRows]: any = await db.execute(sql`SELECT cik, accessionNo, form, filingDate, reportDate, primaryDoc, items FROM filings WHERE cik IN (${sql.join(ciks.map((cik) => sql`${cik}`), sql`, `)}) AND filingDate >= "2000-01-01" AND form IN ("10-Q", "10-K", "8-K", "10-Q/A", "10-K/A", "8-K/A") ORDER BY cik, accessionNo`);
  const [spyRows]: any = await db.execute(sql`SELECT DISTINCT date FROM prices WHERE cik=0 AND source="stooq" ORDER BY date`);
  const spyDates = spyRows.map((row: any) => String(row.date).slice(0, 10));
  const filings: CalendarFiling[] = [];
  for (const company of universe) {
    const metadata = await secJson(company.cik);
    const manifest = readJson<any[]>(path.resolve(`D:/alpha-engine/worker/cache/edgar/${company.cik}/manifest.json`), []);
    const manifestByAccession = new Map(manifest.map((row) => [row.accessionNo, row]));
    for (const row of localRows.filter((item: any) => item.cik === company.cik)) {
      const sec = metadata.get(row.accessionNo) ?? {};
      const cached = manifestByAccession.get(row.accessionNo);
      const accepted = acceptanceEt(sec.acceptanceDateTime) ?? (cached?.eventTs ? cached.eventTs.replace(" ", "T") : null);
      const items = row.items ?? sec.items ?? null;
      const primaryDoc = row.primaryDoc ?? sec.primaryDocument ?? cached?.primaryDoc ?? cached?.docName ?? null;
      const text = items === null ? primaryText(company.cik, row.accessionNo, primaryDoc) : null;
      const flag = earningsFlag(row.form, items, row.filingDate, text);
      filings.push({
        cik: company.cik,
        ticker: company.ticker,
        accessionNo: row.accessionNo,
        form: row.form,
        filingDate: row.filingDate,
        reportDate: row.reportDate ?? sec.reportDate ?? null,
        acceptedEt: accepted,
        acceptedUtc: acceptanceUtc(sec.acceptanceDateTime, accepted),
        acceptedSource: sec.acceptanceDateTime ? "sec_submissions" : cached?.eventTs ? "cache_manifest" : "missing",
        items,
        itemsSource: row.items ? "local_filings" : sec.items ? "sec_submissions" : "unavailable",
        ...flag,
        primaryDoc,
        cachedFiles: cachedFiles(company.cik, row.accessionNo),
      });
    }
  }
  const byAccession = new Map(filings.map((row) => [`${row.cik}|${row.accessionNo}`, row]));
  if (byAccession.size !== localRows.length) throw new Error(`Filing coverage mismatch: ${byAccession.size}/${localRows.length}`);
  const quarters = buildQuarters(filings, spyDates);
  const filingsFile = path.join(outputRoot, "filings-50.jsonl");
  const quartersFile = path.join(outputRoot, "quarters-50.jsonl");
  writeJsonl(filingsFile, filings);
  writeJsonl(quartersFile, quarters);
  const checks = acceptanceChecks(filings, quarters);

  const candidates = filings.filter((row) => row.acceptedEt).sort((a, b) => a.cik - b.cik || a.accessionNo.localeCompare(b.accessionNo));
  const selected = Array.from({ length: Math.min(30, candidates.length) }, (_, index) => candidates[Math.floor(index * candidates.length / Math.min(30, candidates.length))]);
  const headerChecks = [];
  const headerRoot = path.join(outputRoot, "header-checks");
  mkdirSync(headerRoot, { recursive: true });
  for (const row of selected) {
    const evidenceFile = path.join(headerRoot, `${row.cik}-${row.accessionNo}.json`);
    let evidence = readJson<any>(evidenceFile, null);
    if (!evidence) {
      try {
        const header = await fetchDoc(row.cik, row.accessionNo, `${row.accessionNo}-index-headers.html`);
        const match = header.match(/<ACCEPTANCE-DATETIME>(\d{14})/i);
        evidence = { accessionNo: row.accessionNo, acceptedEt: acceptanceEt(match?.[1]), expectedEt: row.acceptedEt };
        writeJsonAtomic(evidenceFile, evidence);
      } catch (error) {
        evidence = { accessionNo: row.accessionNo, error: String(error).slice(0, 200) };
      }
    }
    headerChecks.push({ ...evidence, match: evidence.acceptedEt === row.acceptedEt });
  }
  const summary = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    universe: universe.length,
    filingsTotal: filings.length,
    quartersTotal: quarters.length,
    countsByForm: distribution(filings, "form"),
    countsByYear: distribution(filings, "year"),
    earningsByBasis: distribution(filings.filter((row) => row.isEarningsRelease === true), "basis"),
    ...checks,
    headerChecks: {
      total: headerChecks.length,
      matched: headerChecks.filter((row) => row.match).length,
      failed: headerChecks.filter((row) => !row.match).length,
      finding: "Submissions acceptanceDateTime is an ISO UTC value with Z; filing headers carry New York wall time. acceptedEt uses America/New_York while acceptedUtc preserves the ISO instant, including DST transitions.",
      rows: headerChecks,
    },
    artifacts: {
      filings: { path: filingsFile, bytes: statSync(filingsFile).size, sha256: sha256(filingsFile) },
      quarters: { path: quartersFile, bytes: statSync(quartersFile).size, sha256: sha256(quartersFile) },
    },
  };
  writeJsonAtomic("research/engine/event-calendar-50.summary.json", summary, true);
  const manifest = {
    schemaVersion: 1,
    generatedAt: summary.generatedAt,
    codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    filingsRows: filings.length,
    quartersRows: quarters.length,
    filingsSha256: summary.artifacts.filings.sha256,
    quartersSha256: summary.artifacts.quarters.sha256,
  };
  writeJsonAtomic(path.join(outputRoot, "manifest.json"), manifest, true);
  console.log(JSON.stringify({ filings: filings.length, quarters: quarters.length, accepted: checks.acceptedSince2004, items: checks.itemLists8k, outliers: checks.companyYearOutliers.length, headerMatches: `${summary.headerChecks.matched}/${summary.headerChecks.total}`, artifacts: summary.artifacts }, null, 2));
} finally {
  await db.$client.end();
}
