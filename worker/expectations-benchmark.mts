/** Deterministic independent-gold evaluation of local expectations-v2 extractions. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { derivePlaintext } from "./lib/edgar";
import { evaluateExpectationBenchmark, type BenchmarkFile, type ExtractionForBenchmark } from "./lib/expectations-benchmark";
import type { ExpectationResponse } from "./lib/expectations";
import { exhibitCacheName, mergeGuidanceStatus } from "./lib/exhibits";
import { writeJsonAtomic } from "./lib/json-file";
import type { ManifestEntry } from "./edgar-fetch.mts";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const benchmarkPath = path.resolve(arg("--benchmark") ?? "research/expectations-benchmark-v1.json");
const cohortMode = process.argv.includes("--cohorts");
const outPath = path.resolve(arg("--out") ?? "worker/.runs/expectations-benchmark-report.json");
const cacheRoot = path.resolve(arg("--cache") ?? path.resolve(import.meta.dirname, "cache", "edgar"));
const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8")) as BenchmarkFile;
const extractions = new Map<string, ExtractionForBenchmark>();
const sourceTexts = new Map<string, string>();
for (const doc of benchmark.documents) {
  try {
    const result = JSON.parse(readFileSync(path.join(cacheRoot, String(doc.cik), cohortMode ? "cohort-v2.json" : "expectations-v2.json"), "utf8")) as {
      entries: { accessionNo: string; guidanceStatus: ExpectationResponse["guidanceStatus"] | null; statements: ExtractionForBenchmark["statements"] }[];
    };
    const entries = result.entries.filter((item) => item.accessionNo === doc.accessionNo);
    if (entries.length) {
      extractions.set(doc.accessionNo, {
        accessionNo: doc.accessionNo,
        guidanceStatus: mergeGuidanceStatus(entries.map((entry) => entry.guidanceStatus)),
        statements: entries.flatMap((entry) => entry.statements),
      });
    }
  } catch { /* missing results are reported, never converted into a pass */ }
  try {
    const base = doc.accessionNo.replace(/-/g, "");
    const files: string[] = [];
    if (doc.form.startsWith("8-K")) {
      const manifest = JSON.parse(readFileSync(path.join(cacheRoot, String(doc.cik), "manifest.json"), "utf8")) as ManifestEntry[];
      const entry = manifest.find((item) => item.accessionNo === doc.accessionNo);
      if (entry?.exhibitFiles?.length) {
        files.push(...entry.exhibitFiles.map((file) => path.join(cacheRoot, String(doc.cik), exhibitCacheName(doc.accessionNo, file.name))));
      } else {
        files.push(path.join(cacheRoot, String(doc.cik), `${base}.ex.htm`));
      }
    } else {
      files.push(path.join(cacheRoot, String(doc.cik), `${base}.htm`));
    }
    const text = files.filter((file) => existsSync(file)).map((file) => derivePlaintext(readFileSync(file, "utf8"))).join("\n\n--- EXHIBIT ---\n\n");
    if (text) sourceTexts.set(doc.accessionNo, text);
  } catch { /* evidence remains independently checked by the extractor when source is unavailable here */ }
}
const report = evaluateExpectationBenchmark(benchmark, extractions, sourceTexts);
writeJsonAtomic(outPath, {
  generatedAt: new Date().toISOString(),
  benchmarkPath,
  ...report,
}, true);
console.log(JSON.stringify({ outPath, ...report }, null, 2));
process.exit(report.pass ? 0 : 2);
