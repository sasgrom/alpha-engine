import { describe, expect, it } from "vitest";
import { classifyMacroCorrection } from "./review-macro-correction.mts";

describe("macro correction review", () => {
  it("marks a prod-only exact key as a reviewed delete candidate", () => {
    expect(classifyMacroCorrection([], [])).toBe("delete_candidate_local_missing");
  });

  it("keeps an exact local/archive match and flags mismatches", () => {
    expect(classifyMacroCorrection([{ value: 1, realtimeEnd: null }], [{ value: 1, supersededAt: null }])).toBe("keep_local_row");
    expect(classifyMacroCorrection([{ value: 2, realtimeEnd: null }], [{ value: 1, supersededAt: null }])).toBe("review_archive_mismatch");
    expect(classifyMacroCorrection([{ value: 1, realtimeEnd: null }], [])).toBe("review_local_mismatch");
  });
});
