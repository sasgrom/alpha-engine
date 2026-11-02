/** Build availability-anchored macro scenarios from FRED baselines and SEC exposure evidence. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildMacroScenarioReport, type MacroScenarioDefinition, type ScenarioChannel } from "../api/services/macro-scenarios";
import type { PilotEvidenceReport } from "../api/services/pilot-exposure-evidence";
import type { CompanyExposureReport } from "../api/services/company-exposure";
import type { NormalizedMacroPoint } from "../worker/lib/fred";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const numberArg = (name: string, fallback: number): number => {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
};
const definitions: MacroScenarioDefinition[] = [
  { channel: "rates", shock: numberArg("--rate-shock", 0.01) },
  { channel: "oil", shock: numberArg("--oil-shock", 0.20) },
  { channel: "usd", shock: numberArg("--usd-shock", 0.05) },
  { channel: "credit", shock: numberArg("--credit-shock", 0.01) },
];
const pilotPath = path.resolve("public/reports/pilot-exposure-evidence.json");
const exposurePath = path.resolve("public/reports/company-exposures.json");
for (const file of [pilotPath, exposurePath]) if (!existsSync(file)) throw new Error(`Missing ${file}. Build pilot and company exposure reports first.`);
const pilotReport = JSON.parse(readFileSync(pilotPath, "utf8")) as PilotEvidenceReport;
const exposureReport = JSON.parse(readFileSync(exposurePath, "utf8")) as CompanyExposureReport;
const seriesIds = [...new Set(Object.values({ rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" }))];
const macroSeries: Record<string, NormalizedMacroPoint[]> = {};
for (const seriesId of seriesIds) {
  const file = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
  if (!existsSync(file)) throw new Error(`Missing FRED series ${seriesId} at ${file}`);
  macroSeries[seriesId] = JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[];
}
const prog = startProgress("macro-scenarios", `${definitions.length} scenarios · availability anchored`);
const report = buildMacroScenarioReport({ asOf, definitions, macroSeries, pilot: pilotReport.companies, exposures: exposureReport.companies });
const jsonPath = path.resolve(arg("--out") ?? "public/reports/macro-scenarios.json");
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
writeJsonAtomic(jsonPath, report, true);
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) writeJsonAtomic(path.join(distDir, "macro-scenarios.json"), report, true);
const lines = ["# Macro scenarios", "", `As of: ${report.asOf}`, "Upper bounds and gross exposure are not profit forecasts. Stale evidence is historical only.", ""];
for (const scenario of report.scenarios) {
  lines.push(`## ${scenario.channel.toUpperCase()} · shock ${scenario.shock} · ${scenario.status}`, "");
  if (scenario.baseline) lines.push(`Baseline: ${scenario.baseline.seriesId} ${scenario.baseline.value} → ${scenario.baseline.scenarioValue} ${scenario.baseline.unit} · observation ${scenario.baseline.observationPeriod} · available ${scenario.baseline.availableAt}${scenario.baseline.stale ? " · stale" : ""}`, "");
  else lines.push(`No baseline: ${scenario.reasons.join(", ")}`, "");
  for (const impact of scenario.impacts) {
    lines.push(`- ${impact.ticker}: **${impact.status}**${impact.reasons.length ? ` · ${impact.reasons.join("; ")}` : ""}`);
    for (const metric of impact.metrics) lines.push(`  - ${metric.name}: ${metric.value} ${metric.unit} · ${metric.impactType} · ${metric.periodEnd}${metric.stale ? " · stale" : ""}`);
  }
  lines.push("");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(markdownPath, markdown, "utf8");
if (publish && existsSync(distDir)) writeFileSync(path.join(distDir, "macro-scenarios.md"), markdown, "utf8");
prog.done(`scenarios ${report.scenarios.length} · ${jsonPath}`);
