import "dotenv/config";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, truncateSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { aggregateXbrlExposure, type ExposureFiling, type ExposureMeasureKind } from "../worker/lib/exposure-aggregation";
import { parseXbrl } from "../worker/lib/xbrl-exposure";
import { exposureHistoryRows, assertHistoryAvailability } from "../worker/lib/exposure-history";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { renameWithRetry, writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

interface ManifestFiling {
  accessionNo: string;
  form: string;
  filingDate: string;
  primaryDoc: string;
}
interface CompanyUniverse {
  cik: number;
  ticker: string;
  name?: string;
}
interface CompanyStats {
  documents: number;
  documentsWithMeasures?: number;
  measures: number;
  byMeasure: Record<string, number>;
}
interface Checkpoint {
  inputHash: string;
  completedTickers: string[];
  bytes: number;
  documents: number;
  documentsWithMeasures?: number;
  measureCounts: Record<string, number>;
  companyStats: Record<string, CompanyStats>;
  errors: unknown[];
}
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
if (arg("--only")) throw new Error("--only cannot replace the full-universe history; run the default universe or a separately configured diagnostic script");
const universeFile = arg("--universe") ?? "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile) as CompanyUniverse[];
const outputRoot = realpathSync("D:/research/alpha-engine");
const cacheRoot = realpathSync(path.resolve("worker/cache/edgar"));
if (path.parse(outputRoot).root.toUpperCase() !== "D:\\" || path.parse(cacheRoot).root.toUpperCase() !== "D:\\") throw new Error("D: archive is unavailable; refusing to initialize or use a C: replacement");
const historyPath = path.join(outputRoot, "exposure-history.jsonl");
const buildingPath = `${historyPath}.building`;
const checkpointPath = `${historyPath}.checkpoint.json`;
const latestPath = path.resolve("research/engine/exposure-latest.json");
const publicLatestPath = path.resolve("public/reports/exposure-latest.json");
const summaryPath = path.resolve("research/engine/exposure-history.summary.json");
function manifestHash(): string {
  const hash = createHash("sha256");
  for (const company of universe) {
    const file = path.join(cacheRoot, String(company.cik), "manifest.json");
    hash.update(existsSync(file) ? readFileSync(file) : `${company.ticker}:manifest missing`);
  }
  return hash.digest("hex");
}
const manifestHashAtStart = manifestHash();
const inputHash = createHash("sha256").update(JSON.stringify(universe.map(company => [company.cik, company.ticker]))).update(manifestHashAtStart).update(readFileSync("worker/lib/xbrl-exposure.ts")).update(readFileSync("worker/lib/exposure-aggregation.ts")).update(readFileSync("worker/lib/exposure-history.ts")).update(readFileSync("scripts/build-exposure-history.mts")).digest("hex");
const prog = startProgress("exposure-history", `${universe.length} companies · inline XBRL · read-only · resumable`);
let checkpoint: Checkpoint | null = null;
if (!process.argv.includes("--restart") && existsSync(checkpointPath)) {
  const saved = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint & { status?: string };
  checkpoint = saved.status === "complete" || saved.inputHash !== inputHash ? null : saved;
}
if (checkpoint) {
  if (!existsSync(buildingPath) || statSync(buildingPath).size < checkpoint.bytes) throw new Error("D: building file is shorter than its checkpoint; refusing to skip unverified history");
  if (statSync(buildingPath).size > checkpoint.bytes) truncateSync(buildingPath, checkpoint.bytes);
}
const completed = new Set(checkpoint?.completedTickers ?? []);
let documents = checkpoint?.documents ?? 0;
let documentsWithMeasures = checkpoint?.documentsWithMeasures ?? 0;
const measureCounts = new Map<ExposureMeasureKind, number>(Object.entries(checkpoint?.measureCounts ?? {}) as [ExposureMeasureKind, number][]);
const companyStats = new Map<string, CompanyStats>(Object.entries(checkpoint?.companyStats ?? {}));
const errors: Array<Record<string, unknown>> = (checkpoint?.errors ?? []) as Array<Record<string, unknown>>;
const latestAnnual = new Map<number, ExposureFiling>();
const latestMeasures = new Map<string, ExposureFiling>();
let bytes = checkpoint?.bytes ?? 0;
const historyHash = createHash("sha256");
if (checkpoint) {
  for await (const chunk of createReadStream(buildingPath)) historyHash.update(chunk as Buffer);
  prog.item(completed.size, universe.length, `restored ${completed.size} complete companies · ${bytes} bytes`);
}

function cachedFile(company: CompanyUniverse, filename: string): string {
  const file = realpathSync(path.join(cacheRoot, String(company.cik), filename));
  const relative = path.relative(cacheRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Cache path escapes the D: archive: ${company.ticker}`);
  return file;
}
function filings(company: CompanyUniverse): ManifestFiling[] {
  const manifestPath = path.join(cacheRoot, String(company.cik), "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push({ cik: company.cik, ticker: company.ticker, error: "manifest missing" });
    return [];
  }
  const manifest = JSON.parse(readFileSync(cachedFile(company, "manifest.json"), "utf8")) as ManifestFiling[];
  return manifest.filter(row => (row.form === "10-K" || row.form === "10-Q") && row.accessionNo && row.filingDate).sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
}
async function extract(company: CompanyUniverse, filing: ManifestFiling, emit: boolean, output: ReturnType<typeof createWriteStream> | null): Promise<ExposureFiling | null> {
  const filename = `${filing.accessionNo.replace(/-/g, "")}.htm`;
  const file = path.join(cacheRoot, String(company.cik), filename);
  if (!existsSync(file)) {
    if (filing.filingDate >= "2009-01-01" && emit) errors.push({ cik: company.cik, ticker: company.ticker, accessionNo: filing.accessionNo, error: "primary document missing" });
    return null;
  }
  let exposure: ExposureFiling;
  let sourceUrl = "";
  try {
    const html = readFileSync(cachedFile(company, filename), "utf8");
    const sourceHash = createHash("sha256").update(html).digest("hex");
    sourceUrl = `https://www.sec.gov/Archives/edgar/data/${company.cik}/${filing.accessionNo.replace(/-/g, "")}/${filing.primaryDoc || path.basename(file)}`;
    exposure = aggregateXbrlExposure(parseXbrl(html), { cik: company.cik, ticker: company.ticker, accessionNo: filing.accessionNo, form: filing.form, filingDate: filing.filingDate, sourceUrl, sourceHash });
  } catch (error) {
    if (emit) errors.push({ cik: company.cik, ticker: company.ticker, accessionNo: filing.accessionNo, error: String(error).slice(0, 500) });
    return null;
  }
  if (filing.form === "10-K") latestAnnual.set(company.cik, exposure);
  for (const measure of exposure.measures) latestMeasures.set(`${company.ticker}|${measure.kind}`, { ...exposure, measures: [measure] });
  if (!emit) return exposure;
  documents++;
  if (exposure.measures.length) documentsWithMeasures++;
  const stats = companyStats.get(company.ticker) ?? { documents: 0, measures: 0, byMeasure: {} };
  stats.documents++;
  stats.documentsWithMeasures = (stats.documentsWithMeasures ?? 0) + (exposure.measures.length ? 1 : 0);
  for (const row of exposureHistoryRows(exposure, sourceUrl, exposure.sourceHash!)) {
    assertHistoryAvailability(row);
    const line = `${JSON.stringify(row)}\n`;
    if (!output!.write(line)) await once(output!, "drain");
    bytes += Buffer.byteLength(line);
    historyHash.update(line);
    stats.measures++;
    stats.byMeasure[row.measure] = (stats.byMeasure[row.measure] ?? 0) + 1;
    measureCounts.set(row.measure, (measureCounts.get(row.measure) ?? 0) + 1);
  }
  companyStats.set(company.ticker, stats);
  return exposure;
}

const output = createWriteStream(buildingPath, { flags: checkpoint ? "a" : "w" });
await once(output, "open");
const flush = () => new Promise<void>((resolve, reject) => output.write("", error => error ? reject(error) : resolve()));
for (const [companyIndex, company] of universe.entries()) {
  if (completed.has(company.ticker)) {
    const rows = filings(company);
    const selected = [rows.filter(row => row.form === "10-K").at(-1), rows.at(-1)].filter((row): row is ManifestFiling => Boolean(row));
    const seen = new Set<string>();
    for (const filing of selected) {
      if (seen.has(filing.accessionNo)) continue;
      seen.add(filing.accessionNo);
      await extract(company, filing, false, null);
    }
    prog.item(companyIndex + 1, universe.length, `${company.ticker} · checkpoint restored`);
    continue;
  }
  const seen = new Set<string>();
  for (const filing of filings(company)) {
    if (seen.has(filing.accessionNo)) continue;
    seen.add(filing.accessionNo);
    await extract(company, filing, true, output);
  }
  await flush();
  completed.add(company.ticker);
  writeJsonAtomic(checkpointPath, {
    inputHash,
    completedTickers: universe.filter(row => completed.has(row.ticker)).map(row => row.ticker),
    bytes,
    documents,
    documentsWithMeasures,
    measureCounts: Object.fromEntries(measureCounts),
    companyStats: Object.fromEntries(companyStats),
    errors,
  } satisfies Checkpoint, true);
  prog.item(companyIndex + 1, universe.length, `${company.ticker} · ${documents} documents · ${[...companyStats.values()].reduce((sum, row) => sum + row.measures, 0)} measures`);
}
output.end();
await once(output, "finish");
const companies = [...latestAnnual.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
const measures = [...measureCounts.values()].reduce((sum, count) => sum + count, 0);
if (manifestHash() !== manifestHashAtStart) errors.push({ error: "A filing manifest changed during the run; no mixed-manifest history was published" });
const beforePath = path.resolve("public/reports/macro-scenarios.json");
const before = existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, "utf8")) : null;
const previousSummary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
const beforeCoverage = previousSummary?.beforeCoverage ?? (before ? Object.fromEntries(before.scenarios.map((scenario: { channel: string; impacts: Array<{ status: string }> }) => [scenario.channel, Object.fromEntries(["computable", "historical_only", "not_applicable", "not_computable"].map(status => [status, scenario.impacts.filter(impact => impact.status === status).length]))])) : null);
const manifestRows = universe.flatMap(company => {
  const seen = new Set<string>();
  return filings(company).filter(filing => {
    if (seen.has(filing.accessionNo)) return false;
    seen.add(filing.accessionNo);
    return true;
  }).map(filing => ({ ...filing, cik: company.cik, ticker: company.ticker }));
});
const unavailablePrimaryDocuments = manifestRows.filter(filing => filing.filingDate < "2009-01-01" && !existsSync(path.join(cacheRoot, String(filing.cik), `${filing.accessionNo.replace(/-/g, "")}.htm`))).map(filing => ({ cik: filing.cik, ticker: filing.ticker, accessionNo: filing.accessionNo, form: filing.form, filingDate: filing.filingDate, reason: "pre_inline_xbrl_primary_document_not_cached" }));
const publishedHistoryPath = bytes <= 20 * 1024 * 1024 ? path.resolve("research/engine/exposure-history.jsonl") : historyPath;
const historyReference = publishedHistoryPath === historyPath ? historyPath : path.relative(process.cwd(), publishedHistoryPath).replace(/\\/g, "/");
const previousEvidence = Object.fromEntries(["afterCoverage", "staleEvidenceAudit", "maturityChecks", "financialInterestMargin", "atlasComparison", "atlasAsOf", "scenarioAsOf", "hashes"].filter(key => previousSummary?.[key] !== undefined).map(key => [key, previousSummary[key]]));
const baseSummary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputHash,
  manifestHash: manifestHashAtStart,
  scope: "cached_inline_xbrl",
  manifestDocuments: manifestRows.length,
  unavailablePrimaryDocuments,
  historyFile: historyReference,
  archiveFile: historyPath,
  bytes,
  sha256: historyHash.digest("hex"),
  documents,
  documentsWithMeasures,
  documentsWithoutMeasures: documents - documentsWithMeasures,
  emptyDocumentPolicy: "no_supported_exposure_measure_is_not_an_error",
  measures,
  countsByMeasure: Object.fromEntries([...measureCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  countsByCompany: Object.fromEntries([...companyStats.entries()].sort(([a], [b]) => a.localeCompare(b))),
  latestAnnualCompanies: companies.length,
  beforeCoverage,
  ...previousEvidence,
  errors,
  productionWrite: false,
  databaseWrite: false,
};
if (errors.length) {
  writeJsonAtomic(summaryPath, { ...baseSummary, status: "partial", published: false, buildingFile: buildingPath }, true);
  prog.done(`partial · ${errors.length} errors · previous published history preserved · resume with the same command`);
  process.exit(1);
}
renameWithRetry(buildingPath, historyPath);
if (publishedHistoryPath !== historyPath) {
  mkdirSync(path.dirname(publishedHistoryPath), { recursive: true });
  const temporary = `${publishedHistoryPath}.${process.pid}.tmp`;
  try {
    copyFileSync(historyPath, temporary);
    renameWithRetry(temporary, publishedHistoryPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}
const latest = { schemaVersion: 1, generatedAt: baseSummary.generatedAt, companies, latestMeasures: [...latestMeasures.values()], history: { file: historyReference, bytes, sha256: baseSummary.sha256, documents, measures } };
writeJsonAtomic(latestPath, latest, true);
writeJsonAtomic(publicLatestPath, latest, true);
writeJsonAtomic(summaryPath, { ...baseSummary, status: "complete", published: true }, true);
writeJsonAtomic(checkpointPath, { ...baseSummary, status: "complete", inputHash, completedTickers: [...completed] }, true);
prog.done(`documents ${documents} · measures ${measures} · companies ${companies.length} · ${historyReference} · ${baseSummary.sha256}`);
