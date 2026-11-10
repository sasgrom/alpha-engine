/** Map EDGAR continuity gaps to defensible Schwab fundamental candidates. No replacements are applied. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSchwabFundamentalGapMap } from "../api/services/schwab-fundamental-gap-map";
import type { EdgarGapAnalysis } from "../api/services/edgar-gap-analysis";
import type { SchwabContextReport } from "../api/services/schwab-context";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const gapsPath = path.resolve(arg("--gaps") ?? "public/reports/edgar-coverage-gaps.json");
const contextPath = path.resolve(arg("--context") ?? "public/reports/schwab-context.json");
const universeFile = arg("--universe") ?? "research-universe-50.json";
for (const file of [gapsPath, contextPath]) if (!existsSync(file)) throw new Error(`Missing required report ${file}. Run edgar-gap-analysis and schwab-context first.`);
const gaps = JSON.parse(readFileSync(gapsPath, "utf8")) as EdgarGapAnalysis;
const context = JSON.parse(readFileSync(contextPath, "utf8")) as SchwabContextReport;
const tickerByCik = Object.fromEntries(loadEdgarUniverse(universeFile).map((company) => [company.cik, company.ticker]));
const prog = startProgress("schwab-fundamental-gap-map", `read-only · ${gaps.gaps.length} concept groups`);
const report = buildSchwabFundamentalGapMap(gaps, context, tickerByCik, new Date().toISOString());
const jsonPath = path.resolve("public/reports/schwab-fundamental-gap-map.json");
writeJsonAtomic(jsonPath, report, true);
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "schwab-fundamental-gap-map.json"), report, true);
const lines = [
  "# Schwab fundamental gap mapping", "",
  `Source gap analysis: ${report.sourceGapGeneratedAt}`,
  `Direct candidates: ${report.coverage.direct}`,
  `Derived candidates: ${report.coverage.derived}`,
  `Unsupported concepts: ${report.coverage.unsupported}`, "",
  "Direct and derived fields are usable as snapshot-anchored Schwab provider features with their own provenance. They are not relabeled as EDGAR history. Unsupported concepts remain EDGAR gaps and are not fabricated from Schwab.", "",
  "## Candidates", "",
  ...report.candidates.map((candidate) => `- CIK ${candidate.cik} · ${candidate.concept} · **${candidate.status}** · ${candidate.usage} · ${candidate.schwabFields.join(", ") || "no provider field"}${candidate.formula ? ` · ${candidate.formula}` : ""}${candidate.capturedAt ? ` · captured ${candidate.capturedAt} · SHA256 ${candidate.sourceHash}` : ""} — ${candidate.reason}`),
];
writeFileSync(path.resolve("public/reports/schwab-fundamental-gap-map.md"), `${lines.join("\n")}\n`, "utf8");
if (existsSync(distDir)) writeFileSync(path.join(distDir, "schwab-fundamental-gap-map.md"), `${lines.join("\n")}\n`, "utf8");
prog.done(`direct ${report.coverage.direct} · derived ${report.coverage.derived} · unsupported ${report.coverage.unsupported}`);
