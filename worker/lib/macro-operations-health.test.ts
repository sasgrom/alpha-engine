import { describe, expect, it } from "vitest";
import { MACRO_SERIES } from "./macro-sources";
import { buildMacroHealth, type MacroOperationsArtifacts } from "./macro-operations-health";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const healthy = (): MacroOperationsArtifacts => ({
  fred: { generatedAt: "2026-11-03T05:30:00.000Z", entries: MACRO_SERIES.map((series) => ({ seriesId: series.seriesId, status: "complete" })) },
  events: { generatedAt: "2026-11-03T05:40:00.000Z", events: 47 },
  qa: { generatedAt: "2026-11-03T05:55:00.000Z", status: "pass", errors: 0, warnings: 0 },
  scenarios: { generatedAt: "2026-11-03T05:10:00.000Z", inputHashes: { "fred:DGS10": "fred-v1" } },
  calibration: { generatedAt: "2026-11-03T05:11:00.000Z", inputHashes: { "fred:DGS10": "fred-v1" }, calibrations: [{ status: "ready" }] },
  eventStudy: { generatedAt: "2026-11-03T05:12:00.000Z", inputHashes: { "ofac:events": "ofac-v1" }, status: "ready", events: { eligible: 47, withAnyObservation: 40 } },
  atlas: { generatedAt: "2026-11-03T05:13:00.000Z", inputHashes: { "report:macro-event-study": "study-v1" }, status: "estimated", coverage: { records: 3840 } },
  currentInputs: { "fred:DGS10": "fred-v1", "ofac:events": "ofac-v1", "report:macro-event-study": "study-v1" },
});

describe("macro operations health", () => {
  it("keeps derived reports current when QA reruns over unchanged inputs", () => {
    const value = healthy();
    value.qa!.generatedAt = "2026-11-03T11:55:00.000Z";
    const result = buildMacroHealth(value, NOW);
    expect(result.checks.every((check) => check.status === "ok")).toBe(true);
    expect(result.summary.derivedCurrent).toBe(true);
    expect(result.checks.find((check) => check.id === "macro-scenario-lineage")?.detail).toContain("matches the current content");
  });

  it("uses a weekly freshness window for FRED instead of requiring daily collection", () => {
    const value = healthy();
    value.fred!.generatedAt = "2026-10-27T05:30:00.000Z";
    expect(buildMacroHealth(value, NOW).checks.find((check) => check.id === "macro-fred-evidence")?.status).toBe("ok");
    value.fred!.generatedAt = "2026-10-25T05:30:00.000Z";
    expect(buildMacroHealth(value, NOW).checks.find((check) => check.id === "macro-fred-evidence")?.status).toBe("error");
  });

  it("marks derived reports stale when FRED or OFAC content changes", () => {
    const fred = healthy();
    fred.currentInputs!["fred:DGS10"] = "fred-v2";
    const fredResult = buildMacroHealth(fred, NOW);
    expect(fredResult.checks.find((check) => check.id === "macro-scenario-lineage")?.status).toBe("error");
    expect(fredResult.checks.find((check) => check.id === "macro-calibration-lineage")?.status).toBe("error");
    expect(fredResult.summary.derivedCurrent).toBe(false);

    const ofac = healthy();
    ofac.currentInputs!["ofac:events"] = "ofac-v2";
    expect(buildMacroHealth(ofac, NOW).checks.find((check) => check.id === "macro-event-study-lineage")?.status).toBe("error");
  });

  it("fails closed when lineage is absent and when QA fails", () => {
    const missing = healthy();
    delete missing.scenarios!.inputHashes;
    expect(buildMacroHealth(missing, NOW).checks.find((check) => check.id === "macro-scenario-lineage")?.status).toBe("error");

    const failed = healthy();
    failed.qa!.status = "fail";
    failed.qa!.errors = 1;
    expect(buildMacroHealth(failed, NOW).checks.find((check) => check.id === "macro-qa-evidence")?.status).toBe("error");
  });

  it("keeps OFAC freshness independent from derived content lineage", () => {
    const value = healthy();
    value.events!.generatedAt = "2026-11-01T05:40:00.000Z";
    expect(buildMacroHealth(value, NOW).checks.find((check) => check.id === "macro-ofac-evidence")?.status).toBe("error");
  });
});
