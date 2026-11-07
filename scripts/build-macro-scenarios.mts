/** Build availability-anchored macro scenarios from FRED baselines and SEC exposure evidence. */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { macroPoints } from "@db/schema";
import { buildMacroScenarioReport, type MacroScenarioDefinition, type MacroScenarioReport, type ScenarioChannel } from "../api/services/macro-scenarios";
import type { PilotEvidenceReport } from "../api/services/pilot-exposure-evidence";
import type { CompanyExposureReport } from "../api/services/company-exposure";
import { endOfUtcDay, fredSeriesUrl, sha256Text, type NormalizedMacroPoint } from "../worker/lib/fred";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const macroSource = arg("--macro-source") ?? "file";
if (macroSource !== "file" && macroSource !== "db") throw new Error("--macro-source must be file or db");
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
const pilotPath = path.resolve(arg("--pilot") ?? "public/reports/pilot-exposure-evidence.json");
const exposurePath = path.resolve(arg("--exposure") ?? "public/reports/company-exposures.json");
for (const file of [pilotPath, exposurePath]) if (!existsSync(file)) throw new Error(`Missing ${file}. Build pilot and company exposure reports first.`);
const pilotReport = JSON.parse(readFileSync(pilotPath, "utf8")) as PilotEvidenceReport;
const exposureReport = JSON.parse(readFileSync(exposurePath, "utf8")) as CompanyExposureReport;
const channelSeries: Record<ScenarioChannel, string> = { rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" };
const seriesIds = [...new Set(Object.values(channelSeries))];
const metadata: Record<string, { unit: string; frequency: string }> = {
  DGS10: { unit: "Percent", frequency: "Daily" },
  DCOILWTICO: { unit: "Dollars per Barrel", frequency: "Daily" },
  DTWEXBGS: { unit: "Index Jan 2006=100", frequency: "Daily" },
  BAMLH0A0HYM2: { unit: "Percent", frequency: "Daily, Close" },
};
const macroSeries: Record<string, NormalizedMacroPoint[]> = {};

if (macroSource === "file") {
  for (const seriesId of seriesIds) {
    const file = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
    if (!existsSync(file)) throw new Error(`Missing FRED series ${seriesId} at ${file}`);
    const rows = JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[];
    macroSeries[seriesId] = rows.map((row) => ({ ...row, provenance: row.provenance ?? "official_normalized_archive" }));
  }
} else {
  const db = getDb();
  const rows = await db.select().from(macroPoints).where(inArray(macroPoints.seriesId, seriesIds));
  for (const seriesId of seriesIds) {
    const sourceRows = rows.filter((row) => row.seriesId === seriesId && row.realtimeStart);
    if (!sourceRows.length) continue;
    const sourceHash = sha256Text(JSON.stringify(sourceRows));
    macroSeries[seriesId] = sourceRows.map((row) => {
      const ingestedAt = row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : new Date(row.fetchedAt).toISOString();
      return {
        seriesId,
        observationPeriod: row.date,
        value: row.value,
        unit: metadata[seriesId].unit,
        frequency: metadata[seriesId].frequency,
        releasedAt: null,
        availableAt: `${row.realtimeStart}T00:00:00.000Z`,
        availablePrecision: "day" as const,
        availabilityBasis: "fred_realtime_start" as const,
        researchEligibleAt: endOfUtcDay(row.realtimeStart!),
        vintageId: `${seriesId}|${row.date}|${row.realtimeStart}`,
        supersededAt: !row.realtimeEnd || row.realtimeEnd === "9999-12-31" || row.realtimeEnd >= ingestedAt.slice(0, 10) ? null : endOfUtcDay(row.realtimeEnd),
        ingestedAt,
        sourceUrl: fredSeriesUrl(seriesId),
        sourceHash,
        provenance: "production_macro_points_extract" as const,
      };
    });
  }
  const fallbackPath = arg("--baseline-fallback");
  const missing = seriesIds.filter((seriesId) => !macroSeries[seriesId]?.length);
  if (missing.length) {
    if (!fallbackPath) throw new Error(`No production macro_points for ${missing.join(",")}; supply --baseline-fallback or use --macro-source file`);
    const fallback = JSON.parse(readFileSync(path.resolve(fallbackPath), "utf8")) as MacroScenarioReport;
    if (fallback.dataMode === "fixture") throw new Error("Fixture scenario baselines cannot be promoted to live evidence");
    for (const seriesId of missing) {
      const channel = Object.entries(channelSeries).find(([, id]) => id === seriesId)?.[0] as ScenarioChannel | undefined;
      const baseline = fallback.scenarios.find((scenario) => scenario.channel === channel)?.baseline;
      if (!baseline) throw new Error(`Reviewed fallback has no ${seriesId} baseline`);
      if (!/^[a-f0-9]{64}$/i.test(baseline.sourceHash)) throw new Error(`Reviewed fallback ${seriesId} has invalid source hash`);
      macroSeries[seriesId] = [{
        seriesId: baseline.seriesId,
        observationPeriod: baseline.observationPeriod,
        value: baseline.value,
        unit: baseline.unit,
        frequency: baseline.frequency,
        releasedAt: null,
        availableAt: baseline.availableAt,
        availablePrecision: "day",
        availabilityBasis: baseline.availabilityBasis,
        researchEligibleAt: baseline.researchEligibleAt,
        vintageId: baseline.vintageId,
        supersededAt: baseline.supersededAt,
        ingestedAt: baseline.ingestedAt,
        sourceUrl: baseline.sourceUrl,
        sourceHash: baseline.sourceHash,
        provenance: "reviewed_scenario_snapshot",
      }];
    }
  }
}

const prog = startProgress("macro-scenarios", `${definitions.length} scenarios · ${pilotReport.companies.length} companies · availability anchored`);
const report = buildMacroScenarioReport({ dataMode: process.argv.includes("--fixture") ? "fixture" : "live", asOf, definitions, macroSeries, pilot: pilotReport.companies, exposures: exposureReport.companies });
const jsonPath = path.resolve(arg("--out") ?? "public/reports/macro-scenarios.json");
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
writeJsonAtomic(jsonPath, report, true);
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) writeJsonAtomic(path.join(distDir, "macro-scenarios.json"), report, true);
const lines = ["# Macro scenarios", "", `As of: ${report.asOf}`, "Upper bounds and gross exposure are not profit forecasts. Stale evidence is historical only. Credit uses scheduled twelve-month refinancing upper bounds; new-issuance estimates remain not evaluated.", ""];
for (const scenario of report.scenarios) {
  lines.push(`## ${scenario.channel.toUpperCase()} · shock ${scenario.shock} · ${scenario.status}`, "");
  if (scenario.baseline) lines.push(`Baseline: ${scenario.baseline.seriesId} ${scenario.baseline.value} → ${scenario.baseline.scenarioValue} ${scenario.baseline.unit} · observation ${scenario.baseline.observationPeriod} · available ${scenario.baseline.availableAt} · provenance ${scenario.baseline.provenance ?? "official_normalized_archive"}${scenario.baseline.stale ? " · stale" : ""}`, "");
  else lines.push(`No baseline: ${scenario.reasons.join(", ")}`, "");
  for (const impact of scenario.impacts) {
    lines.push(`- ${impact.ticker}: **${impact.status}**${impact.reasons.length ? ` · ${impact.reasons.join("; ")}` : ""}`);
    for (const metric of impact.metrics) lines.push(`  - ${metric.name}: ${metric.value} ${metric.unit} · ${metric.impactType} · ${metric.periodStart ? `${metric.periodStart} → ` : ""}${metric.periodEnd}${metric.stale ? " · stale" : ""}`);
  }
  lines.push("");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(markdownPath, markdown, "utf8");
if (publish && existsSync(distDir)) writeFileSync(path.join(distDir, "macro-scenarios.md"), markdown, "utf8");
prog.done(`scenarios ${report.scenarios.length} · ${jsonPath}`);
process.exit(0);
