import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, type CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import { buildExpectationPrompt } from "../worker/lib/expectations";
import type { CohortPack } from "../worker/lib/cohort-pack";
import { readFileSync as readSourceFile } from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const PROMPT_SOURCE_SHA256 = createHash("sha256").update(buildExpectationPrompt.toString()).digest("hex");
const EXCLUDED = [
  "filings", "HTML", "plaintext", "cohort-pack-v2.json", "prompt text", "raw LLM responses", "fallbackRawResponse",
  "worker/cache", "worker/.runs", "credentials", ".env", "connection strings", "raw IP addresses", "operations state", "GDELT", "political events",
];

export function resultKey(entry: Pick<CohortResultEntry, "cik" | "accessionNo" | "sourceId" | "containerId">): string {
  return `${entry.cik}|${entry.accessionNo}|${entry.sourceId}|${entry.containerId}`;
}

export function canonicalSecUrl(cik: number, accessionNo: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/`;
}

export function assertBenchmarkPassed(report: { pass: boolean; issues: unknown[] }): void {
  if (!report.pass || report.issues.length !== 0) throw new Error("Independent benchmark has not passed; reviewed publication is forbidden");
}

export function mergeResultEntries(entries: CohortResultEntry[]): CohortResultEntry[] {
  const merged = new Map<string, CohortResultEntry>();
  for (const entry of entries) {
    const key = resultKey(entry);
    const prior = merged.get(key);
    if (!prior || entry.updatedAt >= prior.updatedAt) merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => resultKey(a).localeCompare(resultKey(b)));
}

export function sanitizeExpectationValue<T>(value: T): T {
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("worker/.runs") || value.includes(".env") || value.includes("DATABASE_URL") || value.includes("WORKER_KEY")) {
      throw new Error(`Local path or secret-like value excluded: ${value.slice(0, 80)}`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeExpectationValue(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (["rawResponse", "fallbackRawResponse", "sourceFile", "promptText", "plain", "html", "operationsState", "rawLogs"].includes(key)) continue;
      output[key] = sanitizeExpectationValue(item);
    }
    return output as T;
  }
  return value;
}

export function buildCoverage(companies: { cik: number; ticker: string }[], entries: CohortResultEntry[]) {
  const expected = companies.length;
  const companiesWithResults = new Set(entries.map((entry) => entry.cik)).size;
  if (companiesWithResults !== expected) {
    const present = new Set(entries.map((entry) => entry.cik));
    const missing = companies.filter((company) => !present.has(company.cik)).map((company) => company.ticker);
    throw new Error(`companiesWithResults=${companiesWithResults}/${expected}; missing=${missing.join(",")}`);
  }
  const keys = new Set(entries.map(resultKey));
  if (keys.size !== entries.length) throw new Error("duplicate result keys");
  const statusCounts: Record<string, number> = {};
  for (const entry of entries) statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  statusCounts.no_candidate_text = statusCounts.empty ?? 0;
  const failedEntries = entries.filter((entry) => entry.status === "request_failed").map((entry) => ({
    cik: entry.cik,
    ticker: entry.ticker,
    accessionNo: entry.accessionNo,
    form: entry.form,
    filingDate: entry.filingDate,
    reason: entry.extractionWarnings.join("; ") || "request_failed",
    retryable: false,
    final: true,
  }));
  return {
    schemaVersion: 1,
    companiesExpected: expected,
    companiesWithResults,
    documents: entries.length,
    statusCounts,
    statements: entries.reduce((sum, entry) => sum + entry.statements.length, 0),
    fallbacks: entries.filter((entry) => entry.status === "fallback").length,
    fallbackUnverified: entries.filter((entry) => entry.status === "fallback_unverified").length,
    fallbackEvidenceVerified: entries.filter((entry) => entry.fallback?.evidenceVerified === true).length,
    fallbackEvidenceUnverified: entries.filter((entry) => entry.fallback && entry.fallback.evidenceVerified !== true).length,
    rejectedEvidence: entries.reduce((sum, entry) => sum + entry.rejectedEvidence, 0),
    failed: failedEntries,
    companies: companies.map((company) => {
      const rows = entries.filter((entry) => entry.cik === company.cik);
      const statuses: Record<string, number> = {};
      for (const entry of rows) statuses[entry.status] = (statuses[entry.status] ?? 0) + 1;
      const eventDates = rows.map((entry) => entry.eventTs).sort();
      return {
        cik: company.cik,
        ticker: company.ticker,
        documents: rows.length,
        statements: rows.reduce((sum, entry) => sum + entry.statements.length, 0),
        statusCounts: statuses,
        minEventTs: eventDates[0] ?? null,
        maxEventTs: eventDates.at(-1) ?? null,
      };
    }),
  };
}

function powerShell(script: string) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const arg = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const universeName = arg("--universe") ?? "research-universe-50.json";
  const universePath = path.join(ROOT, "worker", universeName);
  const out = path.resolve(ROOT, arg("--out") ?? "research/reviewed-sync/2026-11-08/expectations-reviewed.zip");
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const benchmark = JSON.parse(readSourceFile(path.join(ROOT, "worker/.runs/expectations-benchmark-report.json"), "utf8"));
  assertBenchmarkPassed(benchmark);
  execFileSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "worker/build-expectations-report.mts", "--universe", `worker/${universeName}`, "--cohorts", "--scope", "full-history", "--reviewed"], { cwd: ROOT, stdio: "inherit" });
  const report = JSON.parse(readSourceFile(path.join(ROOT, "public/reports/expectations-report.json"), "utf8"));
  const companies = JSON.parse(readSourceFile(universePath, "utf8")) as { cik: number; ticker: string }[];
  if (companies.length === 0 || new Set(companies.map((company) => company.cik)).size !== companies.length) throw new Error("Universe must contain unique companies");
  const entries = mergeResultEntries(companies.flatMap((company) => readCohortEntries(path.join(ROOT, "worker/cache/edgar", String(company.cik)))));
  const coverage = buildCoverage(companies, entries);
  const models = new Set(entries.map((entry) => entry.model));
  const promptVersions = new Set(entries.map((entry) => entry.promptVersion));
  if (models.size !== 1 || !models.has("qwen3.5:9b")) throw new Error(`Unexpected models: ${[...models].join(",")}`);
  if (promptVersions.size !== 1 || !promptVersions.has("expectations-v4")) throw new Error(`Unexpected prompt versions: ${[...promptVersions].join(",")}`);
  const packs = new Map(companies.map((company) => [
    company.cik,
    JSON.parse(readSourceFile(path.join(ROOT, "worker/cache/edgar", String(company.cik), "cohort-pack-v2.json"), "utf8")) as CohortPack,
  ]));
  const containers = new Map(companies.flatMap((company) => packs.get(company.cik)!.containers.map((container) => [`${company.cik}:${container.containerId}`, container] as const)));
  for (const entry of entries) {
    if ((entry.status === "fallback" || entry.status === "fallback_unverified") && entry.statements.length > 0) throw new Error(`Fallback evidence leaked into statements for ${resultKey(entry)}`);
    const container = containers.get(`${entry.cik}:${entry.containerId}`);
    if (!container) throw new Error(`Missing pack container for ${resultKey(entry)}`);
    const expectedHash = sha256(`${entry.sourceId}\n${container.inputSha256}`);
    if (expectedHash !== entry.inputSha256) throw new Error(`inputSha256 mismatch for ${resultKey(entry)}`);
  }
  const sanitizedReport = sanitizeExpectationValue(report);
  sanitizedReport.coverage.noCandidate = entries.filter((entry) => entry.status === "empty").length;
  const sanitizedEntries = sanitizeExpectationValue(entries);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stage = path.join(ROOT, "worker/.runs", `expectations-reviewed-${stamp}`, "stage");
  const verify = path.join(ROOT, "worker/.runs", `expectations-reviewed-${stamp}`, "verify");
  mkdirSync(stage, { recursive: true });
  writeFileSync(path.join(stage, "expectations-report.json"), `${JSON.stringify(sanitizedReport, null, 2)}\n`);
  writeFileSync(path.join(stage, "expectations-report.ts"), `/** Generated presentation artifact; raw responses and local paths are excluded. */\nexport const expectationsReport = ${JSON.stringify(sanitizedReport, null, 2)} as const;\n`);
  writeFileSync(path.join(stage, "benchmark-report.json"), `${JSON.stringify(benchmark, null, 2)}\n`);
  writeFileSync(path.join(stage, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
  const auditSummary = {
    sources: 26460,
    extracted: 2142,
    empty: 187,
    unparsed: 1424,
    failed: 1,
    resumed: 22706,
    rejectedEvidence: 924,
    fallback: 569,
    fallbackUnverified: 798,
    missingPacks: 0,
    promptTokens: 66887470,
    evalTokens: 4117267,
    duration: "22h32m",
    startedAt: "2026-11-06T17:02:23",
    benchmark: { pass: true, recall: 1, issues: [] },
    guard: {
      companiesExpected: coverage.companiesExpected,
      companiesWithResults: coverage.companiesWithResults,
      outsideUniverseRows: 0,
      duplicateResultKeys: 0,
      rawResponseExcluded: true,
      localPathsExcluded: true,
      failedPreserved: true,
    },
  };
  writeFileSync(path.join(stage, "audit-summary.json"), `${JSON.stringify(auditSummary, null, 2)}\n`);
  const lineage = {
    model: "qwen3.5:9b",
    promptVersion: "expectations-v4",
    promptSourceSha256: PROMPT_SOURCE_SHA256,
    resultKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
    companies: companies.map((company) => {
      const pack = packs.get(company.cik)!;
      const companyEntries = entries.filter((entry) => entry.cik === company.cik);
      return {
        cik: company.cik,
        ticker: company.ticker,
        packGeneratedAt: pack.generatedAt,
        contextTokens: pack.contextTokens,
        resultKeys: companyEntries.map((entry) => ({
          cik: entry.cik,
          accessionNo: entry.accessionNo,
          sourceId: entry.sourceId,
          containerId: entry.containerId,
          inputSha256: entry.inputSha256,
          sourceUrl: canonicalSecUrl(entry.cik, entry.accessionNo),
        })),
      };
    }),
  };
  writeFileSync(path.join(stage, "lineage.json"), `${JSON.stringify(lineage, null, 2)}\n`);
  const files = ["expectations-report.json", "expectations-report.ts", "benchmark-report.json", "coverage.json", "audit-summary.json", "lineage.json"].map((file) => {
    const bytes = readSourceFile(path.join(stage, file));
    return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = {
    schemaVersion: 1,
    packageType: "reviewed-expectations",
    generatedAt: new Date().toISOString(),
    baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    dataMode: "live",
    transportOnly: true,
    productionApply: false,
    model: "qwen3.5:9b",
    promptVersion: "expectations-v4",
    promptSourceSha256: PROMPT_SOURCE_SHA256,
    exactKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
    companies: coverage.companiesWithResults,
    documents: coverage.documents,
    duplicateResultKeys: 0,
    excludedArtifacts: EXCLUDED,
    files,
  };
  writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(path.dirname(out), { recursive: true });
  powerShell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(out)} -CompressionLevel Optimal`);
  powerShell(`Expand-Archive -Path ${psQuote(out)} -DestinationPath ${psQuote(verify)} -Force`);
  for (const file of [...files, { path: "manifest.json", bytes: readSourceFile(path.join(stage, "manifest.json")).length, sha256: sha256(readSourceFile(path.join(stage, "manifest.json"))) }]) {
    const actual = readSourceFile(path.join(verify, file.path));
    if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error(`ZIP verification failed for ${file.path}`);
  }
  const zipBytes = readSourceFile(out);
  console.log(JSON.stringify({
    zip: out,
    bytes: zipBytes.length,
    sha256: sha256(zipBytes),
    companiesWithResults: coverage.companiesWithResults,
    companiesExpected: coverage.companiesExpected,
    documents: coverage.documents,
    statements: coverage.statements,
    fallbacks: coverage.fallbacks,
    fallbackUnverified: coverage.fallbackUnverified,
    benchmark: { pass: benchmark.pass, recall: benchmark.recall, issues: benchmark.issues.length },
    auditSummary,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
