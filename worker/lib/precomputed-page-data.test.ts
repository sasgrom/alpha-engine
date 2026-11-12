import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageDataVersion, readPageDataArtifact, servePageData, writePageDataArtifact } from "./precomputed-page-data";

const dirs: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "alpha-page-data-"));
  dirs.push(root);
  const stateFile = path.join(root, "operations-state.json");
  writeFileSync(stateFile, JSON.stringify({ lastRuns: { "research-factors": { runId: "run-1", endedAt: "2026-11-11T12:00:00Z", status: "done" } } }));
  return { root, stateFile, parents: ["research-factors"], now: new Date("2026-11-11T13:00:00Z"), codeVersion: "fixture-v1" };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("precomputed page data", () => {
  it("serves a matching artifact with input evidence and code version", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "company-320193", inputs: { rows: 21, latestDate: "2026-11-10" }, payload: { value: 42 } });
    const cached = readPageDataArtifact<{ value: number }>({ ...options, key: "company-320193" });
    expect(cached).toMatchObject({ stale: false, codeVersion: "fixture-v1", payload: { value: 42 } });
    expect(cached?.inputsHash).toHaveLength(64);
    expect(cached?.version.sourceRuns["research-factors"]?.runId).toBe("run-1");
  });

  it("marks changed source jobs stale without recomputing on the page", async () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "dashboard-stats", inputs: { rows: 1 }, payload: { value: 10 } });
    const state = JSON.parse(readFileSync(options.stateFile, "utf8"));
    state.lastRuns["research-factors"].runId = "run-2";
    writeFileSync(options.stateFile, JSON.stringify(state));
    const compute = vi.fn(async () => ({ value: 99 }));
    const result = await servePageData({ ...options, key: "dashboard-stats", compute });
    expect(result).toEqual({ payload: { value: 10 }, asOf: "2026-11-11T13:00:00.000Z", stale: true, dataMode: "precomputed" });
    expect(compute).not.toHaveBeenCalled();
  });

  it("marks a new evaluation day stale", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "probability-320193", inputs: {}, payload: [1, 2] });
    const cached = readPageDataArtifact({ ...options, key: "probability-320193", now: new Date("2026-11-12T00:00:00Z") });
    expect(cached?.stale).toBe(true);
    expect(cached?.payload).toEqual([1, 2]);
  });

  it("uses the existing computation when an artifact is absent or invalid", async () => {
    const options = fixture();
    const compute = vi.fn(async () => ({ value: 5 }));
    expect(await servePageData({ ...options, key: "missing", compute })).toEqual({ payload: { value: 5 }, asOf: null, stale: false, dataMode: "on_request" });
    writeFileSync(path.join(options.root, "broken.json"), "not-json");
    expect(await servePageData({ ...options, key: "broken", compute })).toEqual({ payload: { value: 5 }, asOf: null, stale: false, dataMode: "on_request" });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps source-job ordering deterministic and records changed evidence hashes", () => {
    const options = fixture();
    expect(pageDataVersion(["research-factors", "research-factors"], options.stateFile, false, options.now)).toEqual(pageDataVersion(["research-factors"], options.stateFile, false, options.now));
    const first = writePageDataArtifact({ ...options, key: "stats", inputs: { rows: 1 }, payload: {} });
    const second = writePageDataArtifact({ ...options, key: "stats", inputs: { rows: 2 }, payload: {} });
    expect(first.inputsHash).not.toBe(second.inputsHash);
    expect(first.versionHash).toBe(second.versionHash);
  });
});


describe("source job health", () => {
  it("marks failed source inputs stale even when the artifact version matches", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "stats", inputs: {}, payload: { rows: 1 } });
    const state = JSON.parse(readFileSync(options.stateFile, "utf8"));
    state.lastRuns["research-factors"].status = "error";
    writeFileSync(options.stateFile, JSON.stringify(state));
    expect(readPageDataArtifact({ ...options, key: "stats" })?.stale).toBe(true);
  });

  it("marks a currently running parent stale", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "stats", inputs: {}, payload: { rows: 1 } });
    writeFileSync(options.stateFile, JSON.stringify({ lastRuns: {}, current: { jobId: "research-factors", runId: "run-2", status: "running" } }));
    const cached = readPageDataArtifact({ ...options, key: "stats" });
    expect(cached?.stale).toBe(true);
    expect(pageDataVersion(options.parents, options.stateFile).sourceRuns["research-factors"]).toMatchObject({ runId: "run-2", status: "running", endedAt: null });
  });
});
