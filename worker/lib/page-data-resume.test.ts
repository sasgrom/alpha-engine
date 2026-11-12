import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reusablePageDataArtifact } from "./page-data-resume";
import { writePageDataArtifact } from "./precomputed-page-data";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "alpha-page-resume-"));
  dirs.push(root);
  const stateFile = path.join(root, "state.json");
  writeFileSync(stateFile, JSON.stringify({ lastRuns: { "13f-refresh": { runId: "one", endedAt: "2026-11-11T12:00:00Z", status: "done" } } }));
  return { root, stateFile, parents: ["13f-refresh"], now: new Date("2026-11-11T13:00:00Z") };
}

describe("validated page-data resume", () => {
  it("reuses fresh artifacts only at the accepted code version", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "institutional-320193", codeVersion: "old", inputs: { rows: 1 }, payload: { holders: 20 } });
    expect(reusablePageDataArtifact({ ...options, key: "institutional-320193", expectedCodeVersion: "old" })?.payload).toEqual({ holders: 20 });
    expect(reusablePageDataArtifact({ ...options, key: "institutional-320193", expectedCodeVersion: "new" })).toBeNull();
  });

  it("rejects stale artifacts", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "institutional-320193", codeVersion: "old", inputs: {}, payload: {} });
    writeFileSync(options.stateFile, JSON.stringify({ lastRuns: { "13f-refresh": { runId: "two", endedAt: "2026-11-11T14:00:00Z", status: "done" } } }));
    expect(reusablePageDataArtifact({ ...options, key: "institutional-320193", expectedCodeVersion: "old" })).toBeNull();
  });

  it("distinguishes a cached null payload from a missing artifact", () => {
    const options = fixture();
    writePageDataArtifact({ ...options, key: "probability-320193", codeVersion: "old", inputs: {}, payload: null });
    const cached = reusablePageDataArtifact({ ...options, key: "probability-320193", expectedCodeVersion: "old" });
    expect(cached).not.toBeNull();
    expect(cached?.payload).toBeNull();
  });
});
