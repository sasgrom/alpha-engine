import { MACRO_SERIES } from "./macro-sources";

export interface MacroOperationsArtifacts {
  fred: { generatedAt: string; entries: { seriesId: string; status: string }[] } | null;
  events: { generatedAt: string; events: number } | null;
  qa: { generatedAt: string; status: "pass" | "warn" | "fail"; errors: number; warnings: number } | null;
  scenarios: { generatedAt: string } | null;
  calibration: { generatedAt: string; calibrations: { status: string }[] } | null;
  eventStudy: { generatedAt: string; status: string; events: { eligible: number; withAnyObservation: number } } | null;
}
export interface MacroHealthCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "error" | "pending";
  observedAt: string | null;
  detail: string;
  action: string | null;
  jobId?: string;
}
export interface MacroHealthSummary {
  fredGeneratedAt: string | null;
  ofacGeneratedAt: string | null;
  qaStatus: "pass" | "warn" | "fail" | null;
  derivedCurrent: boolean;
}
const time = (value: string): number => Date.parse(value);
const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)}h`;
const check = (id: string, label: string, status: MacroHealthCheck["status"], observedAt: string | null, detail: string, action: string | null, jobId?: string): MacroHealthCheck => ({ id, label, status, observedAt, detail, action, ...(jobId ? { jobId } : {}) });

function fredCheck(artifacts: MacroOperationsArtifacts, nowMs: number): MacroHealthCheck {
  const manifest = artifacts.fred;
  if (!manifest) return check("macro-fred-evidence", "FRED weekly vintage evidence", "error", null, "FRED manifest is missing.", "npx tsx worker/macro-fred-fetch.mts --group all", "macro-fred-weekly");
  const ids = new Set(manifest.entries.map((entry) => entry.seriesId));
  const missing = MACRO_SERIES.filter((series) => !ids.has(series.seriesId)).length;
  const errors = manifest.entries.filter((entry) => entry.status === "error").length;
  const empty = manifest.entries.filter((entry) => entry.status === "empty").length;
  const ageMs = nowMs - time(manifest.generatedAt);
  const detail = `${ids.size}/${MACRO_SERIES.length} series · ${errors} errors · ${empty} empty · generated ${hours(ageMs)} ago.`;
  const status = ageMs < 0 || ageMs > 8 * 24 * 3_600_000 || missing > 0 || errors > 0 ? "error" : empty > 0 ? "warning" : "ok";
  return check("macro-fred-evidence", "FRED weekly vintage evidence", status, manifest.generatedAt, detail, status === "ok" ? null : "npx tsx worker/macro-fred-fetch.mts --group all", "macro-fred-weekly");
}

function eventsCheck(artifacts: MacroOperationsArtifacts, nowMs: number): MacroHealthCheck {
  const manifest = artifacts.events;
  if (!manifest) return check("macro-ofac-evidence", "OFAC daily event evidence", "error", null, "OFAC manifest is missing.", "npx tsx worker/macro-events-fetch.mts --pages 1", "macro-events-daily");
  const ageMs = nowMs - time(manifest.generatedAt);
  const status = ageMs < 0 || ageMs > 36 * 3_600_000 || manifest.events < 1 ? "error" : "ok";
  return check("macro-ofac-evidence", "OFAC daily event evidence", status, manifest.generatedAt, `${manifest.events} events · generated ${hours(ageMs)} ago.`, status === "ok" ? null : "npx tsx worker/macro-events-fetch.mts --pages 1", "macro-events-daily");
}

function qaCheck(artifacts: MacroOperationsArtifacts): MacroHealthCheck {
  const qa = artifacts.qa;
  if (!qa) return check("macro-qa-evidence", "Macro manifest QA", "error", null, "Macro QA report is missing.", "npx tsx worker/macro-manifest-qa.mts", "macro-manifest-qa");
  const inputTimes = [artifacts.fred?.generatedAt, artifacts.events?.generatedAt].filter((value): value is string => !!value && Number.isFinite(time(value))).map(time);
  const latestInput = inputTimes.length ? Math.max(...inputTimes) : 0;
  const stale = time(qa.generatedAt) < latestInput;
  const status = qa.status === "fail" || stale ? "error" : qa.status === "warn" ? "warning" : "ok";
  return check("macro-qa-evidence", "Macro manifest QA", status, qa.generatedAt, `${qa.status} · ${qa.errors} errors · ${qa.warnings} warnings${stale ? " · report predates current inputs" : ""}.`, status === "ok" ? null : "npx tsx worker/macro-manifest-qa.mts", "macro-manifest-qa");
}

function derivedCheck(artifacts: MacroOperationsArtifacts, kind: "scenarios" | "calibration" | "eventStudy"): MacroHealthCheck {
  const qaAt = artifacts.qa?.generatedAt ?? null;
  const value = artifacts[kind];
  const metadata = kind === "scenarios"
    ? { id: "macro-scenario-lineage", label: "Macro scenario lineage", command: "npx tsx scripts/build-macro-scenarios.mts", jobId: "macro-scenarios" }
    : kind === "calibration"
      ? { id: "macro-calibration-lineage", label: "Shock calibration lineage", command: "npx tsx scripts/build-shock-calibration.mts", jobId: "shock-calibration" }
      : { id: "macro-event-study-lineage", label: "Macro event study lineage", command: "npx tsx scripts/build-macro-event-study.mts", jobId: "macro-event-study" };
  if (!value) return check(metadata.id, metadata.label, "error", null, "Derived report is missing.", metadata.command, metadata.jobId);
  const stale = !!qaAt && time(value.generatedAt) < time(qaAt);
  let detail = stale ? "Derived report predates the current macro QA gate." : "Derived report is current with macro QA.";
  let status: MacroHealthCheck["status"] = stale ? "error" : "ok";
  if (kind === "calibration") {
    const ready = artifacts.calibration!.calibrations.filter((item) => item.status === "ready").length;
    detail += ` ${ready}/${artifacts.calibration!.calibrations.length} calibrations ready.`;
    if (!ready && status === "ok") status = "warning";
  }
  if (kind === "eventStudy") {
    const study = artifacts.eventStudy!;
    detail += ` ${study.status} · ${study.events.withAnyObservation}/${study.events.eligible} eligible events have outcomes.`;
    if (study.status !== "ready" && status === "ok") status = "warning";
  }
  return check(metadata.id, metadata.label, status, value.generatedAt, detail, status === "ok" ? null : metadata.command, metadata.jobId);
}

/** Build artifact-level macro health independently from scheduler run status. */
export function buildMacroHealth(artifacts: MacroOperationsArtifacts, nowMs: number): { checks: MacroHealthCheck[]; summary: MacroHealthSummary } {
  const checks = [fredCheck(artifacts, nowMs), eventsCheck(artifacts, nowMs), qaCheck(artifacts), derivedCheck(artifacts, "scenarios"), derivedCheck(artifacts, "calibration"), derivedCheck(artifacts, "eventStudy")];
  const qaAt = artifacts.qa?.generatedAt ?? null;
  const current = (value: { generatedAt: string } | null) => !!value && (!qaAt || time(value.generatedAt) >= time(qaAt));
  return {
    checks,
    summary: {
      fredGeneratedAt: artifacts.fred?.generatedAt ?? null,
      ofacGeneratedAt: artifacts.events?.generatedAt ?? null,
      qaStatus: artifacts.qa?.status ?? null,
      derivedCurrent: current(artifacts.scenarios) && current(artifacts.calibration) && current(artifacts.eventStudy),
    },
  };
}
