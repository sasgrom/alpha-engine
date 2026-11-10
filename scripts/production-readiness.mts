/** Report production-readiness without modifying files, data or production state. */
import { existsSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../worker/lib/json-file";

interface Check { id: string; file: string; required: boolean; present: boolean; action: string }
const macroRoot = path.resolve(process.env.MACRO_ROOT ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const checks: Check[] = [
  { id: "pilot-evidence", file: "public/reports/pilot-exposure-evidence.json", required: true, present: false, action: "npx tsx scripts/build-pilot-exposure-evidence.mts" },
  { id: "company-exposure", file: "public/reports/company-exposures.json", required: true, present: false, action: "npx tsx scripts/build-company-exposure.mts --universe research-universe-50.json" },
  { id: "scenario-report", file: "public/reports/macro-scenarios.json", required: true, present: false, action: "npx tsx scripts/build-macro-scenarios.mts --macro-root D:\\research\\alpha-engine\\macro" },
  { id: "fred-manifest", file: path.join(macroRoot, "manifest-fred.json"), required: true, present: false, action: "npx tsx worker/macro-fred-fetch.mts --group all" },
  { id: "ofac-manifest", file: path.join(macroRoot, "manifest-events.json"), required: true, present: false, action: "npx tsx worker/macro-events-fetch.mts --pages 1" },
  { id: "ofac-events", file: path.join(macroRoot, "normalized", "ofac-events.json"), required: true, present: false, action: "npx tsx worker/macro-events-fetch.mts --pages 1" },
  ...["DGS10", "DCOILWTICO", "DTWEXBGS", "BAMLH0A0HYM2"].map((seriesId): Check => ({
    id: `fred-${seriesId}`,
    file: path.join(macroRoot, "normalized", "fred", `${seriesId}.json`),
    required: true,
    present: false,
    action: `npx tsx worker/macro-fred-fetch.mts --series ${seriesId}`,
  })),
  { id: "shock-calibration", file: "public/reports/shock-calibration.json", required: false, present: false, action: "npx tsx scripts/build-shock-calibration.mts --macro-root D:\\research\\alpha-engine\\macro" },
  { id: "macro-event-study", file: "public/reports/macro-event-study.json", required: false, present: false, action: "npx tsx scripts/build-macro-event-study.mts --macro-root D:\\research\\alpha-engine\\macro" },
  { id: "macro-transmission-atlas", file: "public/reports/macro-transmission-atlas.json", required: false, present: false, action: "npx tsx scripts/build-macro-transmission-atlas.mts" },
  { id: "production-bundle", file: "dist/public/index.html", required: false, present: false, action: "npm run build" },
];
const evaluated = checks.map((check) => ({ ...check, present: existsSync(check.file) }));
const missing = evaluated.filter((check) => !check.present);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: missing.length ? "missing" : "ready",
  macroRoot,
  required: evaluated.filter((check) => check.required),
  optional: evaluated.filter((check) => !check.required),
  missing,
};
writeJsonAtomic(path.resolve("worker/.runs/production-readiness.json"), report, true);
console.log(JSON.stringify({ status: report.status, missing: missing.map((check) => ({ id: check.id, file: check.file, action: check.action })), optional: report.optional }, null, 2));
if (missing.length) process.exitCode = 1;
