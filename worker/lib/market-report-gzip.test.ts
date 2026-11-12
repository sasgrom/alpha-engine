import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMarketReportGzip } from "./market-report-gzip";
import { readPageDataArtifact } from "./precomputed-page-data";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("market report gzip builder", () => {
  it("creates a missing root and preserves the exact JSON and source lineage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "alpha-gzip-builder-"));
    dirs.push(root);
    const sourceFile = path.join(root, "source.json");
    const artifactRoot = path.join(root, "new", "nested");
    const stateFile = path.join(root, "state.json");
    const raw = JSON.stringify({ generatedAt: "2026-11-11T12:00:00.000Z", rows: Array.from({ length: 100 }, (_, index) => ({ ticker: "AAPL", value: index })) });
    writeFileSync(sourceFile, raw);
    writeFileSync(stateFile, JSON.stringify({ lastRuns: {} }));
    const result = buildMarketReportGzip({ sourceFile, root: artifactRoot, codeVersion: "test-v1", stateFile });
    expect(gunzipSync(readFileSync(result.gzipFile)).toString("utf8")).toBe(raw);
    expect(result.payload.sourceBytes).toBe(Buffer.byteLength(raw));
    expect(result.payload.sourceSha256).toHaveLength(64);
    expect(result.gzipBytes).toBeLessThan(raw.length);
    const artifact = readPageDataArtifact({ key: "market-report-gzip", parents: ["schwab-snapshot"], root: artifactRoot, stateFile, includeDay: false });
    expect(artifact).toMatchObject({ codeVersion: "test-v1", stale: false, payload: result.payload });
  });
});
