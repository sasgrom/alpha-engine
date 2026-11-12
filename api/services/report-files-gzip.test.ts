import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportFileResponse } from "./report-files";
import { MARKET_REPORT_PARENTS, PAGE_DATA_KEYS } from "./page-data";
import { writePageDataArtifact } from "../../worker/lib/precomputed-page-data";

let root: string;
let reports: string;
let cache: string;
let stateFile: string;
let raw: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "alpha-report-gzip-"));
  reports = path.join(root, "reports");
  cache = path.join(root, "cache");
  stateFile = path.join(root, "state.json");
  raw = JSON.stringify({ generatedAt: "2026-11-11T12:00:00.000Z", options: [{ ticker: "AAPL", bid: 10 }] });
  writeFileSync(stateFile, JSON.stringify({ lastRuns: {} }));
  const sourceFile = path.join(reports, "schwab-market-data.json");
  mkdirSync(reports, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(sourceFile, raw);
  const sourceStat = statSync(sourceFile);
  const payload = {
    gzipFile: "schwab-market-data.json.gz",
    sourceGeneratedAt: "2026-11-11T12:00:00.000Z",
    sourceBytes: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    gzipSha256: createHash("sha256").update(gzipSync(raw)).digest("hex"),
  };
  writeFileSync(path.join(cache, payload.gzipFile), gzipSync(raw));
  writePageDataArtifact({ key: PAGE_DATA_KEYS.marketReport, parents: MARKET_REPORT_PARENTS, root: cache, stateFile, includeDay: false, codeVersion: "test", inputs: payload, payload });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function request(acceptEncoding = "gzip") {
  return reportFileResponse("schwab-market-data.json", { db: null, staticRoot: reports, pageDataRoot: cache, operationsStateFile: stateFile, acceptEncoding });
}

describe("precompressed market report", () => {
  it("serves the identical JSON as gzip with its original generation time", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("x-report-generated-at")).toBe("2026-11-11T12:00:00.000Z");
    expect(response.headers.get("x-report-source")).toBe("static");
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")).toBe(raw);
    const identity = await request("");
    expect(identity.headers.get("content-encoding")).toBeNull();
    expect(await identity.text()).toBe(raw);
  });

  it("refuses a compressed artifact after its source changes", async () => {
    raw = JSON.stringify({ generatedAt: "2026-11-11T12:00:00.000Z", options: [{ ticker: "AAPL", bid: 11 }] });
    writeFileSync(path.join(reports, "schwab-market-data.json"), raw);
    const response = await request();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(raw);
  });

  it("keeps valid gzip when job metadata changes but the source is unchanged", async () => {
    writeFileSync(stateFile, JSON.stringify({ lastRuns: { "schwab-snapshot": { runId: "new-run", endedAt: "2026-11-11T13:00:00Z", status: "done" } } }));
    const response = await request();
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")).toBe(raw);
  });
});
