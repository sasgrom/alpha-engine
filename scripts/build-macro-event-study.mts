/** Build a first-release, availability-anchored OFAC macro event study. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildMacroEventStudyReport, type MacroEventSummary } from "../api/services/macro-event-study";
import type { CalibrationChannel } from "../api/services/shock-calibration";
import type { NormalizedMacroPoint } from "../worker/lib/fred";
import type { PoliticalEvent } from "../worker/lib/political-events";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const generatedAt = new Date().toISOString();
const asOf = arg("--as-of") ?? generatedAt;
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const definitions = [
  { seriesId: "DGS10", channel: "rates" as const },
  { seriesId: "DCOILWTICO", channel: "oil" as const },
  { seriesId: "DTWEXBGS", channel: "usd" as const },
  { seriesId: "BAMLH0A0HYM2", channel: "credit" as const },
] satisfies { seriesId: string; channel: CalibrationChannel }[];
const series = definitions.map((definition) => {
  const file = path.join(macroRoot, "normalized", "fred", `${definition.seriesId}.json`);
  if (!existsSync(file)) throw new Error(`Missing FRED series ${definition.seriesId} at ${file}`);
  return { ...definition, rows: JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[] };
});
const eventsPath = path.join(macroRoot, "normalized", "ofac-events.json");
if (!existsSync(eventsPath)) throw new Error(`Missing OFAC events at ${eventsPath}`);
const events = JSON.parse(readFileSync(eventsPath, "utf8")) as PoliticalEvent[];
const prog = startProgress("macro-event-study", `${events.length} events · ${series.length} series · first-release vintages`);
const report = buildMacroEventStudyReport({ events, series, asOf, generatedAt, dataMode: process.argv.includes("--fixture") ? "fixture" : "live" });
const jsonPath = path.resolve("public/reports/macro-event-study.json");
const markdownPath = path.resolve("public/reports/macro-event-study.md");
writeJsonAtomic(jsonPath, report, true);
const number = (value: number | null) => value === null ? "—" : value.toFixed(6);
const summary = (value: MacroEventSummary | null) => value ? `n=${value.n} · mean ${number(value.mean)} · median ${number(value.median)} · CI95 ${value.ci95Mean ? `${number(value.ci95Mean[0])}…${number(value.ci95Mean[1])}` : "—"}` : "insufficient events";
const lines = [
  "# Macro event study",
  "",
  `As of: ${report.asOf} · Status: ${report.status}`,
  "First-release vintages only. Baseline must be known at event eligibility; outcomes start on the next observation day. Discovery and out-of-sample splits are chronological 70/30. Results are measurements, not directional forecasts.",
  "",
  `Events: ${report.events.eligible}/${report.events.total} eligible · ${report.events.withBaseline} with baseline · ${report.events.withAnyObservation} with any outcome · ${report.events.discovery} discovery / ${report.events.outOfSample} OOS`,
  "",
];
for (const study of report.studies) {
  lines.push(`## ${study.seriesId} · ${study.channel} · ${study.unit}`, "");
  for (const horizon of ["1", "5", "21", "63"] as const) {
    lines.push(`- ${horizon} observation(s) · Discovery: ${summary(study.horizons[horizon].discovery)}`);
    lines.push(`  OOS: ${summary(study.horizons[horizon].outOfSample)}`);
  }
  lines.push("");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(markdownPath, markdown, "utf8");
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) {
  writeJsonAtomic(path.join(distDir, "macro-event-study.json"), report, true);
  writeFileSync(path.join(distDir, "macro-event-study.md"), markdown, "utf8");
}
prog.done(`${report.status} · observations ${report.observations.length} · ${jsonPath}`);
