/** Independent post-extraction QA over local cohort packs and merged per-source checkpoints. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEdgarUniverse } from "./lib/edgar";
import { dedupeExpectationUniverse } from "./lib/universe";
import { readCohortEntries } from "./lib/cohort-checkpoint";
import { auditCohortResults } from "./lib/cohort-qa";
import type { CohortPack } from "./lib/cohort-pack";
import { writeJsonAtomic } from "./lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-50.json";
const strict = process.argv.includes("--strict");
const universe = dedupeExpectationUniverse(loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only));
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const outputRoot = path.resolve("worker/.runs/cohort-qa");
let failed = 0;
let incomplete = 0;
for (const company of universe) {
  const cacheDir = path.resolve(import.meta.dirname, "cache", "edgar", String(company.cik));
  const packPath = path.join(cacheDir, "cohort-pack-v2.json");
  if (!existsSync(packPath)) {
    console.log(`[cohort-qa] ${company.ticker} · no pack`);
    continue;
  }
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as CohortPack;
  const entries = readCohortEntries(cacheDir);
  const report = auditCohortResults(pack, entries);
  writeJsonAtomic(path.join(outputRoot, `${company.ticker}.json`), report, true);
  if (report.status === "fail") failed++;
  if (report.status === "incomplete") incomplete++;
  const s = report.summary;
  console.log(`[cohort-qa] ${company.ticker} · ${report.status.toUpperCase()} · sources ${s.completedSources}/${s.packSources} · statements ${s.statements} · not_found ${s.notFound} · fallback ${s.fallback} · prompt p50/p95 ${s.medianPromptTokens}/${s.p95PromptTokens} · generated p50/p95 ${s.medianGeneratedTokens}/${s.p95GeneratedTokens} · hard ${s.hardErrors} · review ${s.reviewFlags}`);
}
console.log(`[cohort-qa] reports ${outputRoot} · failed ${failed} · incomplete ${incomplete}`);
if (strict && failed) process.exit(2);
