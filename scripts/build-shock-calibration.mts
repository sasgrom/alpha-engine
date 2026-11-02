/** Build availability-anchored shock distributions and confidence intervals from FRED history. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildShockCalibrationReport, type CalibrationChannel } from "../api/services/shock-calibration";
import type { NormalizedMacroPoint } from "../worker/lib/fred";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const definitions = [
  { seriesId: "DGS10", channel: "rates" as const },
  { seriesId: "DCOILWTICO", channel: "oil" as const },
  { seriesId: "DTWEXBGS", channel: "usd" as const },
  { seriesId: "BAMLH0A0HYM2", channel: "credit" as const },
];
const series = definitions.map((definition) => {
  const file = path.join(macroRoot, "normalized", "fred", `${definition.seriesId}.json`);
  if (!existsSync(file)) throw new Error(`Missing FRED series ${definition.seriesId} at ${file}`);
  return { ...definition, rows: JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[] };
});
const prog = startProgress("shock-calibration", `${series.length} series · moving-block bootstrap`);
const report = buildShockCalibrationReport(series, asOf, new Date().toISOString());
const jsonPath = path.resolve("public/reports/shock-calibration.json");
writeJsonAtomic(jsonPath, report, true);
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "shock-calibration.json"), report, true);
const lines = ["# Shock calibration", "", `As of: ${report.asOf}`, "Absolute daily changes. Percentiles are not directional forecasts; confidence intervals use 200 moving-block bootstrap replicates.", ""];
for (const calibration of report.calibrations) {
  lines.push(`## ${calibration.seriesId} · ${calibration.channel} · ${calibration.status}`, "");
  if (calibration.presets) lines.push(`Mild p50: ${calibration.presets.mild.shock} · Severe p90: ${calibration.presets.severe.shock} · Extreme p99: ${calibration.presets.extreme.shock}`, "");
  for (const horizon of ["1", "5", "21", "63"] as const) {
    const distribution = calibration.distributions[horizon];
    if (distribution) lines.push(`- ${horizon} observation(s): n=${distribution.n} · p50 ${distribution.p50} · p75 ${distribution.p75} · p90 ${distribution.p90} · p95 ${distribution.p95} · p99 ${distribution.p99} · p50 CI95 ${distribution.ci95P50?.join("…")} · p90 CI95 ${distribution.ci95P90?.join("…")}`);
  }
  lines.push("");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(path.resolve("public/reports/shock-calibration.md"), markdown, "utf8");
if (existsSync(distDir)) writeFileSync(path.join(distDir, "shock-calibration.md"), markdown, "utf8");
for (const calibration of report.calibrations) prog.log(`${calibration.seriesId}: ${calibration.status} · observations ${calibration.observations}`);
prog.done(`calibrations ${report.calibrations.length} · ${jsonPath}`);
