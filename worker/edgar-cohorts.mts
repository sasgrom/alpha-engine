/** Build bounded, timestamped cohort evidence packs. No LLM calls and no production writes. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { derivePlaintext, loadEdgarUniverse } from "./lib/edgar";
import { buildCohortPackWithHashes, cohortInputLimit, type CohortSourceDocument, type UnpackedBlock } from "./lib/cohort-pack";
import { expectationSourcesFor } from "./lib/expectation-sources";
import { selectLatestFilings } from "./lib/filing-selection";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { ManifestEntry } from "./edgar-fetch.mts";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const from = arg("--from");
const fromTicker = arg("--from-ticker")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-53.json";
const latestOnly = process.argv.includes("--latest");
const benchmarkOnly = process.argv.includes("--benchmark");
const contextTokens = Number(arg("--context") ?? process.env.OLLAMA_NUM_CTX ?? 32768);
if (!Number.isInteger(contextTokens) || contextTokens < 2048 || contextTokens > 262144) throw new Error("--context must be an integer from 2048 to 262144");
const benchmarkAccessions = benchmarkOnly
  ? new Set((JSON.parse(readFileSync(path.resolve("research/expectations-benchmark-v1.json"), "utf8")) as { documents: { accessionNo: string }[] }).documents.map((doc) => doc.accessionNo))
  : null;
const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const outputPath = (cik: number) => path.join(cacheDir(cik), "cohort-pack-v2.json");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const supportedForm = (form: string) => /^(?:10-K|10-Q|8-K)(?:\/A)?$/.test(form);
const universeAll = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universeAll.length) throw new Error(`Unknown ticker ${only}`);
const start = fromTicker ? universeAll.findIndex((company) => company.ticker === fromTicker) : 0;
if (fromTicker && start < 0) throw new Error(`Unknown --from-ticker ${fromTicker}`);
const universe = universeAll.slice(Math.max(0, start));
const prog = startProgress("edgar-cohorts", `context ${contextTokens} tok · max input ${cohortInputLimit(contextTokens)} chars · full blocks only`);
const totals = { companies: 0, periods: 0, documents: 0, containers: 0, unpacked: 0, charBytes: 0, estimatedTokens: 0 };
for (const company of universe) {
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(path.join(cacheDir(company.cik), "manifest.json"), "utf8")); }
  catch { prog.log(`${company.ticker}: no manifest`); continue; }
  const eligible = manifest.filter((entry) => entry.fetched && supportedForm(entry.form) && (!from || entry.filingDate >= from) && (!benchmarkAccessions || benchmarkAccessions.has(entry.accessionNo)));
  const filings = latestOnly ? selectLatestFilings(eligible) : eligible;
  const documents: CohortSourceDocument[] = [];
  const unpacked: UnpackedBlock[] = [];
  for (const filing of filings) {
    for (const source of expectationSourcesFor(cacheDir(company.cik), filing)) {
      try {
        const plain = derivePlaintext(readFileSync(source.sourceFile, "utf8"));
        documents.push({
          cik: company.cik,
          ticker: company.ticker,
          accessionNo: filing.accessionNo,
          sourceId: source.sourceId,
          form: filing.form,
          role: source.role,
          sourceFile: source.sourceFile,
          filingDate: filing.filingDate,
          eventTs: filing.eventTs,
          reportDate: filing.reportDate,
          plain,
        });
      } catch {
        unpacked.push({ sourceId: source.sourceId, accessionNo: filing.accessionNo, reason: "cache_unreadable", charBytes: 0, estimatedTokens: 0 });
      }
    }
  }
  const pack = buildCohortPackWithHashes(documents, { contextTokens, generatedAt: new Date().toISOString() }, sha256);
  pack.unpacked.push(...unpacked);
  pack.coverage.unpacked += unpacked.length;
  writeJsonAtomic(outputPath(company.cik), pack, true);
  totals.companies++;
  totals.periods += pack.coverage.periods;
  totals.documents += pack.coverage.documents;
  totals.containers += pack.coverage.containers;
  totals.unpacked += pack.coverage.unpacked;
  totals.charBytes += pack.coverage.charBytes;
  totals.estimatedTokens += pack.coverage.estimatedTokens;
  prog.stageDone(`${company.ticker}: periods ${pack.coverage.periods} · docs ${pack.coverage.documents} · containers ${pack.coverage.containers} · ${(pack.coverage.charBytes / 1024).toFixed(1)} KiB · ~${pack.coverage.estimatedTokens.toLocaleString("en-US")} tok · unpacked ${pack.coverage.unpacked}`);
}
prog.done(`all done · companies ${totals.companies} · periods ${totals.periods} · docs ${totals.documents} · containers ${totals.containers} · ${(totals.charBytes / 1024 / 1024).toFixed(2)} MiB · ~${totals.estimatedTokens.toLocaleString("en-US")} tok · unpacked ${totals.unpacked}`);
