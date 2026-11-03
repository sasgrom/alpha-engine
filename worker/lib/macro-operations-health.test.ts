import { describe, expect, it } from "vitest";
import { MACRO_SERIES } from "./macro-sources";
import { buildMacroHealth, type MacroOperationsArtifacts } from "./macro-operations-health";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const healthy = (): MacroOperationsArtifacts => ({
  fred: { generatedAt: "2026-11-03T05:30:00.000Z", entries: MACRO_SERIES.map((series) => ({ seriesId: series.seriesId, status: "complete" })) },
  events: { generatedAt: "2026-11-03T05:40:00.000Z", events: 47 },
  qa: { generatedAt: "2026-11-03T05:55:00.000Z", status: "pass", errors: 0, warnings: 0 },
  scenarios: { generatedAt: "2026-11-03T06:10:00.000Z" },
  calibration: { generatedAt: "2026-11-03T06:11:00.000Z", calibrations: [{ status: "ready" }] },
  eventStudy: { generatedAt: "2026-11-03T06:12:00.000Z", status: "ready", events: { eligible: 47, withAnyObservation: 40 } },
});

describe("macro operations health", () => {
  it("accepts current weekly FRED, daily OFAC, QA and derived lineage", () => {
    const result = buildMacroHealth(healthy(), NOW);
    expect(result.checks.every((check) => check.status === "ok")).toBe(true);
    expect(result.summary.derivedCurrent).toBe(true);
  });

  it("uses a weekly freshness window for FRED instead of requiring daily collection", () => {
    const value = healthy();
    value.fred!.generatedAt = "2026-10-27T05:30:00.000Z";
    expect(buildMacroHealth(value, NOW).checks.find((check) => check.id === "macro-fred-evidence")?.status).toBe("ok");
    value.fred!.generatedAt = "2026-10-25T05:30:00.000Z";
    expect(buildMacroHealth(value, NOW).checks.find((check) => check.id === "macro-fred-evidence")?.status).toBe("error");
  });

  it("fails closed when a derived report predates QA or OFAC is stale", () => {
    const value = healthy();
    value.scenarios!.generatedAt = "2026-11-03T05:50:00.000Z";
    value.eventStudy!.generatedAt = "2026-11-03T05:50:00.000Z";
    value.eventStudy!.status = "insufficient_events";
    value.events!.generatedAt = "2026-11-01T05:40:00.000Z";
    const result = buildMacroHealth(value, NOW);
    expect(result.checks.find((check) => check.id === "macro-scenario-lineage")?.status).toBe("error");
    expect(result.checks.find((check) => check.id === "macro-event-study-lineage")?.status).toBe("error");
    expect(result.checks.find((check) => check.id === "macro-ofac-evidence")?.status).toBe("error");
    expect(result.summary.derivedCurrent).toBe(false);
  });
});
