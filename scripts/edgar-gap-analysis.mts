/** Analyze EDGAR continuity gaps by era, concept and missing quarter. Read-only. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { analyzeEdgarGaps } from "../api/services/edgar-gap-analysis";
import type { FundamentalIntegrityReport } from "../api/services/fundamental-integrity";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const since = arg("--since") ?? "2000-01-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since))) throw new Error("--since must be YYYY-MM-DD");
const maxGaps = Number(arg("--max-gaps") ?? 5000);
if (!Number.isInteger(maxGaps) || maxGaps < 100 || maxGaps > 50_000) throw new Error("--max-gaps must be between 100 and 50000");
const input = path.resolve(arg("--input") ?? "public/reports/fundamental-integrity.json");
if (!existsSync(input)) throw new Error(`Missing ${input}. Run fundamental-integrity-audit.mts first.`);
const source = JSON.parse(readFileSync(input, "utf8")) as FundamentalIntegrityReport;
const prog = startProgress("edgar-gap-analysis", `read-only · since ${since}`);
const report = analyzeEdgarGaps(source, new Date().toISOString(), since, maxGaps);
const jsonPath = path.resolve("public/reports/edgar-coverage-gaps.json");
writeJsonAtomic(jsonPath, report, true);
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "edgar-coverage-gaps.json"), report, true);
const lines = [
  "# EDGAR coverage and continuity gap analysis", "",
  `Source generated: ${report.sourceGeneratedAt}`,
  `Analysis generated: ${report.generatedAt}`,
  `Included periodEnd >= ${since}`,
  `Excluded pre-2000 issues: ${report.summary.excludedPre2000}`,
  `Errors: ${report.summary.errors} · warnings: ${report.summary.warnings}`,
  `Continuity issues: ${report.summary.continuityIssues} · unique missing quarters: ${report.summary.continuityQuarters}`,
  `Omitted concept groups beyond display cap: ${report.omittedGaps}`, "",
  "## By era", "",
  ...report.byEra.map((row) => `- ${row.era}: ${row.errors} errors · ${row.warnings} warnings`),
  "",
  "## By issue type", "",
  ...report.byType.map((row) => `- ${row.type}: ${row.count}`),
  "",
  "## Largest concept gaps", "",
  ...report.gaps.slice(0, 40).map((gap) => `- CIK ${gap.cik} · ${gap.concept}: ${gap.missingQuarters.length} missing quarters (${gap.firstMissingPeriod ?? "unknown"} → ${gap.lastMissingPeriod ?? "unknown"}). ${gap.recommendedAction}`),
];
writeJsonAtomic(path.resolve("public/reports/edgar-coverage-gaps.md"), `${lines.join("\n")}\n`, true);
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "edgar-coverage-gaps.md"), `${lines.join("\n")}\n`, true);
prog.done(`errors ${report.summary.errors} · warnings ${report.summary.warnings} · concepts ${report.gaps.length} · omitted ${report.omittedGaps}`);
