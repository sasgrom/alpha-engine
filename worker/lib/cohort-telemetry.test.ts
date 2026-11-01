import { describe, expect, it } from "vitest";
import { formatCohortWindow, summarizeCohortWindow } from "./cohort-telemetry";

describe("cohort rolling telemetry", () => {
  it("separates LLM time, fallback rate and non-LLM checkpoint overhead", () => {
    const report = summarizeCohortWindow([
      { wallMs: 10_000, llmMs: 8_000, promptTokens: 1000, evalCount: 100, fallback: false },
      { wallMs: 20_000, llmMs: 15_000, promptTokens: 3000, evalCount: 300, fallback: true },
    ]);
    expect(report.documentsPerMinute).toBeCloseTo(4);
    expect(report.meanPromptTokens).toBe(2000);
    expect(report.meanEvalCount).toBe(200);
    expect(report.fallbackShare).toBe(0.5);
    expect(report.meanLlmMs).toBe(11_500);
    expect(report.meanOtherMs).toBe(3_500);
  });

  it("uses only the ten newest sources in the human-readable rolling window", () => {
    const rows = Array.from({ length: 11 }, () => ({ wallMs: 1000, llmMs: 500, promptTokens: 100, evalCount: 10, fallback: false }));
    rows[0] = { wallMs: 60_000, llmMs: 60_000, promptTokens: 100_000, evalCount: 1000, fallback: true };
    const report = summarizeCohortWindow(rows.slice(-10));
    expect(report.meanPromptTokens).toBe(100);
    expect(report.fallbackShare).toBe(0);
    expect(formatCohortWindow(rows)).toContain("last 10 new sources");
    expect(formatCohortWindow(rows)).toContain("fallback 0%");
  });
});
