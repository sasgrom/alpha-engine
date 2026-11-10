import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMacroCorrection, readMacroCorrectionKeys } from "./review-macro-correction.mts";

describe("macro correction review", () => {
  it("marks a prod-only exact key as a reviewed delete candidate", () => {
    expect(classifyMacroCorrection([], [])).toBe("delete_candidate_local_missing");
  });

  it("keeps an exact local/archive match and flags mismatches", () => {
    expect(classifyMacroCorrection([{ value: 1, realtimeEnd: null }], [{ value: 1, supersededAt: null }])).toBe("keep_local_row");
    expect(classifyMacroCorrection([{ value: 2, realtimeEnd: null }], [{ value: 1, supersededAt: null }])).toBe("review_archive_mismatch");
    expect(classifyMacroCorrection([{ value: 1, realtimeEnd: null }], [])).toBe("review_local_mismatch");
  });

  it("reads prod keys from gzip CSV with date mapped to observationPeriod", () => {
    const file = path.join(tmpdir(), `macro-prod-keys-${process.pid}-${Date.now()}.csv.gz`);
    try {
      writeFileSync(file, gzipSync("seriesId,date,realtimeStart,realtimeEnd,value,sourceHash\nDGS10,2023-10-20,2026-10-19,2026-10-19,4.52,\n"));
      expect(readMacroCorrectionKeys(file)).toEqual([{ seriesId: "DGS10", observationPeriod: "2023-10-20", realtimeStart: "2026-10-19", prodRealtimeEnd: "2026-10-19", prodValue: 4.52, prodSourceHash: null }]);
    } finally {
      rmSync(file, { force: true });
    }
  });
});
