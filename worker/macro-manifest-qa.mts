/** Fail-closed QA for macro manifests, normalized rows, raw hashes and OFAC events. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MACRO_SERIES } from "./lib/macro-sources";
import { artifactIssue, auditMacroEvents, auditNormalizedMacroSeries, type ManifestQaIssue } from "./lib/macro-manifest-qa";
import type { NormalizedMacroPoint } from "./lib/fred";
import type { PoliticalEvent } from "./lib/political-events";
import { writeJsonAtomic } from "./lib/json-file";

interface Artifact { file: string; sha256: string }
interface FredEntry { seriesId: string; status: string; rows: number; error?: string; raw: { metadata: Artifact | null; observations: Artifact | null; vintageDates: Artifact | null } }
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const root = path.resolve(arg("--root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const fredOnly = process.argv.includes("--fred-only");
const eventsOnly = process.argv.includes("--events-only");
const allowPartial = process.argv.includes("--allow-partial");
if (fredOnly && eventsOnly) throw new Error("Choose only one of --fred-only or --events-only");
const issues: ManifestQaIssue[] = [];
const fredPath = path.join(root, "manifest-fred.json");
if (!eventsOnly) {
  if (!existsSync(fredPath)) issues.push({ severity: "error", code: "manifest_missing", detail: fredPath });
  else {
    const manifest = JSON.parse(readFileSync(fredPath, "utf8")) as { researchSince?: string; entries: FredEntry[] };
    if (manifest.researchSince !== "2000-01-01") issues.push({ severity: "error", code: "research_window", detail: `researchSince=${manifest.researchSince ?? "missing"}` });
    for (const definition of MACRO_SERIES) {
      const entry = manifest.entries.find((item) => item.seriesId === definition.seriesId);
      if (!entry) {
        issues.push({ severity: allowPartial ? "warning" : "error", code: "series_missing", detail: definition.seriesId });
        continue;
      }
      if (entry.status === "error") issues.push({ severity: "error", code: "series_error", detail: `${definition.seriesId}: ${entry.error ?? "unknown"}` });
      if (entry.status === "empty") issues.push({ severity: "warning", code: "series_empty", detail: definition.seriesId });
      for (const artifact of Object.values(entry.raw)) if (artifact) {
        const issue = artifactIssue(artifact.file, artifact.sha256);
        if (issue) issues.push(issue);
      }
      const normalizedPath = path.join(root, "normalized", "fred", `${definition.seriesId}.json`);
      if (!existsSync(normalizedPath)) issues.push({ severity: "error", code: "normalized_missing", detail: normalizedPath });
      else {
        const rows = JSON.parse(readFileSync(normalizedPath, "utf8")) as NormalizedMacroPoint[];
        issues.push(...auditNormalizedMacroSeries(definition.seriesId, rows, entry.rows));
      }
    }
  }
}
const eventsPath = path.join(root, "manifest-events.json");
if (!fredOnly) {
  if (!existsSync(eventsPath)) issues.push({ severity: "error", code: "events_manifest_missing", detail: eventsPath });
  else {
    const manifest = JSON.parse(readFileSync(eventsPath, "utf8")) as { pages: { file: string; sha256: string }[] };
    for (const page of manifest.pages) {
      const issue = artifactIssue(page.file, page.sha256);
      if (issue) issues.push(issue);
    }
    const normalizedPath = path.join(root, "normalized", "ofac-events.json");
    if (!existsSync(normalizedPath)) issues.push({ severity: "error", code: "events_normalized_missing", detail: normalizedPath });
    else issues.push(...auditMacroEvents(JSON.parse(readFileSync(normalizedPath, "utf8")) as PoliticalEvent[]));
  }
}
const errors = issues.filter((issue) => issue.severity === "error").length;
const warnings = issues.length - errors;
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), root, status: errors ? "fail" : warnings ? "warn" : "pass", errors, warnings, issues };
writeJsonAtomic(path.resolve("worker/.runs/macro-manifest-qa.json"), report, true);
console.log(JSON.stringify({ status: report.status, errors, warnings, firstIssues: issues.slice(0, 20) }, null, 2));
if (errors) process.exitCode = 1;
