import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearCohortEntryCache, readCohortEntries, readCohortResult, writeCohortEntryAtomic, writeCohortResultSnapshot, type CohortResultEntry } from "./cohort-checkpoint";

const directories: string[] = [];
const temp = () => { const directory = mkdtempSync(path.join(tmpdir(), "cohort-checkpoint-")); directories.push(directory); return directory; };
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

const entry = (sourceId: string, updatedAt: string): CohortResultEntry => ({
  cik: 1,
  ticker: "AAA",
  cohortId: "2026-09-30",
  containerId: "2026-09-30__001",
  sourceId,
  accessionNo: "0001-26-000001",
  form: "8-K",
  filingDate: "2026-10-30",
  eventTs: "2026-10-30 12:00:00",
  reportDate: "2026-09-30",
  sourceFile: "a.htm",
  inputSha256: "input",
  model: "model",
  promptVersion: "prompt",
  status: "extracted",
  guidanceStatus: "found",
  statements: [],
  extractionWarnings: [],
  rejectedEvidence: 0,
  rawResponse: "{}",
  fallback: null,
  fallbackRawResponse: null,
  fallbackUsage: null,
  usage: null,
  updatedAt,
});

describe("cohort per-source checkpoints", () => {
  it("resumes from per-source files even when the company snapshot is stale", () => {
    const directory = temp();
    const snapshot = { schemaVersion: 2, contextTokens: 32768, packGeneratedAt: "pack", unpacked: [], entries: [entry("old", "2026-10-30T00:00:00Z")] };
    writeCohortResultSnapshot(directory, snapshot);
    writeCohortEntryAtomic(directory, entry("new", "2026-10-30T00:01:00Z"));
    expect(readCohortEntries(directory).map((item) => item.sourceId)).toEqual(["new", "old"]);
    expect(readCohortResult(directory)?.entries).toHaveLength(2);
  });

  it("resumes before the first company snapshot exists", () => {
    const directory = temp();
    writeCohortEntryAtomic(directory, entry("first", "2026-10-30T00:01:00Z"));
    const result = readCohortResult(directory, { schemaVersion: 2, contextTokens: 32768, packGeneratedAt: "current-pack", unpacked: [] });
    expect(result?.packGeneratedAt).toBe("current-pack");
    expect(result?.entries.map((item) => item.sourceId)).toEqual(["first"]);
  });

  it("clears stale per-source generations without touching the reviewed snapshot", () => {
    const directory = temp();
    writeCohortResultSnapshot(directory, { schemaVersion: 2, contextTokens: 32768, packGeneratedAt: "old-pack", unpacked: [], entries: [entry("snapshot", "2026-10-30T00:00:00Z")] });
    writeCohortEntryAtomic(directory, entry("stale", "2026-10-30T00:01:00Z"));
    clearCohortEntryCache(directory);
    const result = readCohortResult(directory);
    expect(result?.packGeneratedAt).toBe("old-pack");
    expect(result?.entries.map((item) => item.sourceId)).toEqual(["snapshot"]);
  });

  it("uses the newest version of a source without duplicating it", () => {
    const directory = temp();
    writeCohortResultSnapshot(directory, { schemaVersion: 2, contextTokens: 32768, packGeneratedAt: "pack", unpacked: [], entries: [entry("same", "2026-10-30T00:00:00Z")] });
    writeCohortEntryAtomic(directory, { ...entry("same", "2026-10-30T00:02:00Z"), status: "fallback" });
    const entries = readCohortEntries(directory);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("fallback");
    expect(entries[0].updatedAt).toBe("2026-10-30T00:02:00Z");
  });
});
