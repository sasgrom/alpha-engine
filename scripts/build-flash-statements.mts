import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { buildFactIndex, type SecFact } from "../worker/lib/flash-facts";
import { evaluateGolden, type GoldenDocument } from "../worker/lib/flash-golden";
import { processRelease, sourceSha256, type ExhibitInput, type ProcessReleaseResult, type ReleaseContext } from "../worker/lib/flash-pipeline";
import { buildFlashSummary, buildFlashSummaryStreaming } from "../worker/lib/flash-summary";
import { buildFlashExtractSummary, flashQuarterRecord } from "../worker/lib/flash-extract";
import { writeJsonAtomic } from "../worker/lib/json-file";

interface CalendarFiling {
  cik: number;
  ticker: string;
  accessionNo: string;
  filingDate: string;
  acceptedEt: string | null;
  isEarningsRelease: boolean | null;
}

interface CalendarQuarter {
  cik: number;
  fiscalPeriodEnd: string;
  periodicForm: string;
  periodicAccession: string;
  earningsAccession: string | null;
  earningsFilings: { accessionNo: string }[];
}

interface CachedRelease {
  schemaVersion: 1;
  codeHash: string;
  context: ReleaseContext;
  inputSha256: string;
  cacheable?: boolean;
  result: ProcessReleaseResult;
}

const args = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const options = (name: string) => args.flatMap((value, index) => value === name ? [args[index + 1]] : []);
const checkOnly = args.includes("--check");
const goldenOnly = args.includes("--golden");
const force = args.includes("--force");
const ticker = option("--ticker")?.toUpperCase();
const accession = option("--accession");
const limit = option("--limit") ? Number(option("--limit")) : null;
const filingsFiles = options("--filings").length ? options("--filings") : ["D:/research/alpha-engine/engine/events/filings-50.jsonl"];
const quartersFiles = options("--quarters").length ? options("--quarters") : ["D:/research/alpha-engine/engine/events/quarters-50.jsonl"];
const universeFiles = options("--universe");
const outputRoot = path.resolve(option("--output") ?? "D:/research/alpha-engine/engine/flash");
const summaryFile = option("--summary") ?? "research/engine/flash-statements-50.summary.json";
const extractFile = option("--extract") ? path.resolve(option("--extract")!) : null;
const customRun = options("--filings").length > 0 || options("--quarters").length > 0 || universeFiles.length > 0 || option("--output") !== undefined || option("--summary") !== undefined || extractFile !== null;
const cacheRoot = path.resolve(process.env.ALPHA_EDGAR_CACHE ?? "D:/alpha-engine/worker/cache/edgar");
const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const codeFiles = ["scripts/build-flash-statements.mts", "scripts/check-flash-golden.mts", "worker/lib/flash-extract.ts", "worker/lib/flash-html.ts", "worker/lib/flash-facts.ts", "worker/lib/flash-pipeline.ts", "worker/lib/flash-summary.ts", "worker/lib/flash-golden.ts", "worker/lib/json-file.ts"];
const codeHash = createHash("sha256");
for (const file of codeFiles.slice().sort()) codeHash.update(file).update("\0").update(readFileSync(file));
const codeFingerprint = codeHash.digest("hex");
const previousCodeFingerprint = (() => {
  try {
    const value = JSON.parse(readFileSync(path.join(outputRoot, "manifest.json"), "utf8")).codeHash;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
})();
const goldenDocuments = (JSON.parse(readFileSync("docs/engine/tasks/K03-golden.json", "utf8")) as { documents: GoldenDocument[] }).documents;

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

function hashBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashFile(file: string): string {
  return hashBytes(readFileSync(file));
}

async function hashFileStream(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeJsonlStream(file: string, releases: ReleaseContext[], readResult: (release: ReleaseContext) => ProcessReleaseResult, select: (result: ProcessReleaseResult, release: ReleaseContext) => unknown[]): Promise<{ path: string; bytes: number; sha256: string }> {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const stream = createWriteStream(temporary, { encoding: "utf8" });
  try {
    for (const release of releases) {
      const result = readResult(release);
      for (const row of select(result, release)) {
        if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, "drain");
      }
    }
    stream.end();
    await once(stream, "finish");
    renameSync(temporary, file);
    return { path: file, bytes: statSync(file).size, sha256: await hashFileStream(file) };
  } finally {
    stream.destroy();
    rmSync(temporary, { force: true });
  }
}

function contexts(): ReleaseContext[] {
  const filings = filingsFiles.flatMap((file) => readJsonl<CalendarFiling>(file)).filter((row) => row.isEarningsRelease === true && row.filingDate >= "2009-01-01");
  const quarters = quartersFiles.flatMap((file) => readJsonl<CalendarQuarter>(file));
  const links = new Map<string, CalendarQuarter[]>();
  for (const quarter of quarters) {
    for (const earnings of quarter.earningsFilings) {
      const key = `${quarter.cik}|${earnings.accessionNo}`;
      links.set(key, [...(links.get(key) ?? []), quarter]);
    }
  }
  const identities = new Set<string>();
  return filings.map((filing) => {
    const identity = `${filing.cik}|${filing.accessionNo}`;
    if (identities.has(identity)) throw new Error(`Duplicate release identity: ${identity}`);
    identities.add(identity);
    const candidates = links.get(identity) ?? [];
    const pair = candidates.filter((quarter) => quarter.fiscalPeriodEnd < filing.filingDate).sort((a, b) => a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd)).at(-1) ?? candidates[0];
    return {
      cik: filing.cik,
      ticker: filing.ticker,
      accessionNo: filing.accessionNo,
      filingDate: filing.filingDate,
      acceptedEt: filing.acceptedEt,
      fiscalPeriodEnd: pair?.fiscalPeriodEnd ?? null,
      periodicAccession: candidates.length === 1 ? pair.periodicAccession : null,
      periodicForm: candidates.length === 1 ? pair.periodicForm : null,
    };
  });
}

function exhibitsFor(release: ReleaseContext): { exhibits: ExhibitInput[]; errors: string[]; duplicates: number } {
  const directory = path.join(cacheRoot, String(release.cik));
  if (!existsSync(directory)) return { exhibits: [], errors: [], duplicates: 0 };
  const base = release.accessionNo.replaceAll("-", "");
  const files = readdirSync(directory).filter((file) => file.startsWith(`${base}.ex`) && file.endsWith(".htm")).sort();
  const byHash = new Map<string, ExhibitInput>();
  const errors: string[] = [];
  let duplicates = 0;
  for (const file of files) {
    try {
      const bytes = readFileSync(path.join(directory, file));
      const sha256 = hashBytes(bytes);
      if (byHash.has(sha256)) {
        duplicates++;
        continue;
      }
      const html = bytes.toString("utf8");
      const type = html.slice(0, 4096).match(/<TYPE>\s*(EX-99\.\d+)/i)?.[1];
      if (!type && !/ex-?99/i.test(file)) continue;
      byHash.set(sha256, { file: path.join(String(release.cik), file), sha256, html });
    } catch (error) {
      errors.push(`${release.accessionNo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { exhibits: [...byHash.values()], errors, duplicates };
}

function inputHash(exhibits: ExhibitInput[]): string {
  return hashBytes(JSON.stringify(exhibits.map((exhibit) => ({ file: exhibit.file, sha256: exhibit.sha256 }))));
}

function cacheFile(release: ReleaseContext): string {
  return path.join(outputRoot, "releases", String(release.cik), `${release.accessionNo}.json`);
}

function readCached(release: ReleaseContext, exhibits: ExhibitInput[]): ProcessReleaseResult | null {
  try {
    const cached = JSON.parse(readFileSync(cacheFile(release), "utf8")) as CachedRelease;
    const compatibleCode = cached.codeHash === codeFingerprint || cached.codeHash === previousCodeFingerprint;
    if (cached.schemaVersion !== 1 || !compatibleCode || cached.inputSha256 !== inputHash(exhibits) || cached.cacheable === false || JSON.stringify(cached.context) !== JSON.stringify(release)) return null;
    return cached.result;
  } catch {
    return null;
  }
}

async function sectorEvidence(db: any, releases: ReleaseContext[]) {
  const ciks = [...new Set(releases.map((release) => release.cik))].sort((a, b) => a - b);
  const [rows]: any = await db.execute(sql`SELECT cik, sector FROM companies WHERE cik IN (${sql.join(ciks.map((cik) => sql`${cik}`), sql`,`)})`);
  const sectorByCik = new Map<number, string>();
  for (const row of rows) sectorByCik.set(Number(row.cik), row.sector ? String(row.sector) : "Unclassified");
  const classified = [...sectorByCik.values()].filter((sector) => sector !== "Unclassified").length;
  return {
    sectorByCik,
    evidence: {
      source: "local MySQL companies.sector; read-only and filtered to release CIKs",
      readAt: new Date().toISOString(),
      companies: ciks.length,
      classified,
      unclassified: ciks.length - classified,
    },
  };
}

function factRows(rows: any[]): SecFact[] {
  return rows.map((row) => ({
    cik: Number(row.cik),
    concept: String(row.concept),
    unit: String(row.unit),
    startDate: row.startDate ? String(row.startDate).slice(0, 10) : null,
    endDate: String(row.endDate).slice(0, 10),
    val: Number(row.val),
    form: row.form ? String(row.form) : null,
    filed: row.filed ? String(row.filed).slice(0, 10) : null,
    accn: row.accn ? String(row.accn) : null,
  }));
}

async function main() {
  const db = getDb();
  try {
    let releases = contexts();
    if (goldenOnly) {
      const wanted = new Set(goldenDocuments.map((document) => `${document.cik}|${document.accessionNo}`));
      releases = releases.filter((release) => wanted.has(`${release.cik}|${release.accessionNo}`));
    }
    if (ticker) releases = releases.filter((release) => release.ticker === ticker);
    if (accession) releases = releases.filter((release) => release.accessionNo === accession);
    if (limit !== null) releases = releases.slice(0, limit);
    if (!releases.length) throw new Error("No releases selected");
    if (!checkOnly) {
      if (!/^d:/i.test(outputRoot) || (extractFile && !/^d:/i.test(extractFile))) throw new Error("Flash checkpoints and artifacts must stay on D:");
      mkdirSync(outputRoot, { recursive: true });
      if (!/^d:/i.test(realpathSync(outputRoot))) throw new Error("The flash output directory must resolve to D:");
    }
    const results = new Map<string, ProcessReleaseResult>();
    const retainResults = checkOnly || ticker || accession || limit !== null;
    let cacheHits = 0;
    let processedThisRun = 0;
    let exhibitCount = 0;
    let duplicateExhibits = 0;
    let missingExhibitReleases = 0;
    for (const cik of [...new Set(releases.map((release) => release.cik))].sort((a, b) => a - b)) {
      const companyReleases = releases.filter((release) => release.cik === cik);
      const pending: { release: ReleaseContext; exhibits: ExhibitInput[]; errors: string[] }[] = [];
      for (const release of companyReleases) {
        const { exhibits, errors, duplicates } = exhibitsFor(release);
        if (!exhibits.length && !errors.length) missingExhibitReleases++;
        exhibitCount += exhibits.length;
        duplicateExhibits += duplicates;
        if (!checkOnly && !force) {
          const cached = readCached(release, exhibits);
          if (cached) {
            if (retainResults) results.set(release.accessionNo, cached);
            cacheHits++;
            continue;
          }
        }
        pending.push({ release, exhibits, errors });
      }
      if (!pending.length) continue;
      const [rows]: any = await db.execute(sql`SELECT cik, concept, unit, startDate, endDate, val, form, filed, accn FROM facts WHERE cik=${cik} ORDER BY id`);
      const factIndex = buildFactIndex(factRows(rows));
      for (const { release, exhibits, errors } of pending) {
        let result: ProcessReleaseResult;
        try {
          result = processRelease(release, exhibits, factIndex, errors);
        } catch (error) {
          result = processRelease(release, [], buildFactIndex([]), [...errors, error instanceof Error ? error.message : String(error)]);
        }
        if (retainResults) results.set(release.accessionNo, result);
        processedThisRun++;
        if (!checkOnly) {
          try {
            writeJsonAtomic(cacheFile(release), { schemaVersion: 1, codeHash: codeFingerprint, context: release, inputSha256: inputHash(exhibits), cacheable: result.errors.length === 0, result } satisfies CachedRelease);
          } catch (error) {
            throw new Error(`Checkpoint write failed for ${release.ticker} ${release.accessionNo}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      console.log(`[flash] ${companyReleases[0].ticker}: ${companyReleases.length} releases prepared`);
    }
    const run = { expectedReleases: releases.length, cacheHits, processedThisRun, exhibits: exhibitCount, duplicateExhibits, missingExhibitReleases };
    if (checkOnly || ticker || accession || limit !== null) {
      const ordered = releases.map((release) => results.get(release.accessionNo)!);
      const summary = buildFlashSummary({ releases, results: ordered, generatedAt: new Date().toISOString(), codeCommit, codeHash: codeFingerprint, goldenDocuments, run, artifacts: {} });
      console.log(JSON.stringify({ coverage: summary.coverage.overall, naming: summary.naming.overall, grades: summary.grades.overall, mismatchPatterns: summary.grades.mismatchPatterns, golden: summary.golden, pointInTime: summary.pointInTime, errors: summary.errors }, null, 2));
      if (goldenOnly && summary.golden.failed.length) process.exitCode = 1;
      return;
    }
    const readResult = (release: ReleaseContext) => (JSON.parse(readFileSync(cacheFile(release), "utf8")) as CachedRelease).result;
    mkdirSync(outputRoot, { recursive: true });
    const artifacts: Record<string, { path: string; bytes: number; sha256: string }> = {
      statements: await writeJsonlStream(path.join(outputRoot, "statements.jsonl"), releases, readResult, (result) => result.statements),
      values: await writeJsonlStream(path.join(outputRoot, "values.jsonl"), releases, readResult, (result) => result.values),
      grades: await writeJsonlStream(path.join(outputRoot, "grades.jsonl"), releases, readResult, (result) => result.grades),
      residual: await writeJsonlStream(path.join(outputRoot, "residual.jsonl"), releases, readResult, (result) => result.residual),
    };
    if (extractFile) artifacts.flashQuarter = await writeJsonlStream(extractFile, releases, readResult, (result, release) => [flashQuarterRecord(release, result)]);
    const generatedAt = new Date().toISOString();
    const summary: any = buildFlashSummaryStreaming({ releases, readResult, generatedAt, codeCommit, codeHash: codeFingerprint, goldenDocuments, run, artifacts });
    if (customRun) summary.inputs = {
      filings: filingsFiles.map((file) => ({ path: file, sha256: hashFile(file) })),
      quarters: quartersFiles.map((file) => ({ path: file, sha256: hashFile(file) })),
      universe: universeFiles.map((file) => ({ path: file, sha256: hashFile(file) })),
    };
    if (universeFiles.length) {
      const universe = universeFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")) as { cik: number; ticker: string; name: string }[]);
      const withReleases = new Set(releases.map((release) => release.cik)), withoutReleases = universe.filter((company) => !withReleases.has(company.cik));
      summary.universe = { companies: universe.length, companiesWithReleases: withReleases.size, withoutReleases };
      const tickers = withoutReleases.map((company) => company.ticker);
      for (const key of ["companiesWithoutStatements", "companiesWithoutIncome", "companiesWithoutBalance", "companiesWithoutCashflow"]) summary.coverage[key] = [...new Set([...summary.coverage[key], ...tickers])].sort();
    }
    if (extractFile) {
      const sectors = await sectorEvidence(db, releases);
      summary.extract = { ...buildFlashExtractSummary({ releases, readResult, sectorByCik: sectors.sectorByCik }), sectorEvidence: sectors.evidence };
    }
    if (customRun) {
      const periodPass = summary.coverage.overall.periodShare !== null && summary.coverage.overall.periodShare >= 0.98;
      const gradePass = summary.grades.overall.matchShare !== null && summary.grades.overall.matchShare >= 0.98;
      const printedPass = summary.pointInTime.printedValues.violations.length === 0, answerKeyPass = summary.pointInTime.answerKeyFacts.violations.length === 0;
      summary.acceptance = {
        pass: periodPass && gradePass && printedPass && answerKeyPass,
        periodMatch: { pass: periodPass, share: summary.coverage.overall.periodShare, minimum: 0.98 },
        gradableValues: { pass: gradePass, matchShare: summary.grades.overall.matchShare, minimum: 0.98 },
        printedValues: { pass: printedPass, violations: summary.pointInTime.printedValues.violations.length },
        answerKeyFacts: { pass: answerKeyPass, violations: summary.pointInTime.answerKeyFacts.violations.length },
      };
    }
    writeJsonAtomic(summaryFile, summary, true);
    const manifest = {
      schemaVersion: 1,
      generatedAt,
      codeCommit,
      codeHash: codeFingerprint,
      status: summary.acceptance && !summary.acceptance.pass ? "acceptance_failed" : summary.errors.length ? "complete_with_errors" : "complete",
      run: summary.run,
      inputs: customRun ? summary.inputs : undefined,
      artifacts,
      summary: { path: summaryFile, bytes: statSync(summaryFile).size, sha256: hashFile(summaryFile) },
      productionWrite: false,
    };
    writeJsonAtomic(path.join(outputRoot, "manifest.json"), manifest, true);
    if (summary.acceptance && !summary.acceptance.pass) process.exitCode = 1;
    console.log(JSON.stringify({ run: summary.run, coverage: summary.coverage.overall, naming: summary.naming.overall, grades: summary.grades.overall, golden: { total: summary.golden.total, passed: summary.golden.passed, failed: summary.golden.failed.length }, pointInTime: summary.pointInTime, extract: summary.extract?.overall ?? null, acceptance: summary.acceptance ?? null, artifacts, manifest: { bytes: statSync(path.join(outputRoot, "manifest.json")).size, sha256: hashFile(path.join(outputRoot, "manifest.json")) } }, null, 2));
  } finally {
    await db.$client.end();
  }
}

await main();
