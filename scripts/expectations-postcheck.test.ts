import { describe, expect, it } from "vitest";
import { assertExpectationsPostCheck, expectedExpectationsPostCheck } from "./lib/expectations-postcheck";
import { gzipWorkerJson, workerExpectationsApiUrl } from "./lib/worker-expectations-api";
import { gunzipSync } from "node:zlib";
import { canonicalExpectationResultRow } from "../contracts/expectations-apply";

const reviewed = {
  manifest: { packageVersion: "3.3", scope: "reviewed_partial_history", normalizationVersion: "expectation-normalization-v2", benchmarkEvaluationType: "post-remediation regression" },
  readiness: { status: "blocked" },
  results: [
    { cik: 1, accessionNo: "a", sourceId: "s", containerId: "c", inputSha256: "h", sourceUrl: "https://www.sec.gov/Archives/a", status: "extracted", guidanceStatus: "found", statements: [], extractionWarnings: [], rejectedEvidence: 0 },
  ],
  statements: 0,
};

describe("via-api reviewed apply post-check", () => {
  it("accepts matching canonical package and result hashes", () => {
    const response = { packageVersion: "3.3", results: 1, statements: 0, postCheck: { tables: expectedExpectationsPostCheck(reviewed) } };
    expect(() => assertExpectationsPostCheck(response, reviewed)).not.toThrow();
  });

  it("rejects a server content hash mismatch", () => {
    const tables = expectedExpectationsPostCheck(reviewed);
    tables[1].contentSha256 = "0".repeat(64);
    expect(() => assertExpectationsPostCheck({ packageVersion: "3.3", results: 1, statements: 0, postCheck: { tables } }, reviewed)).toThrow("post-check mismatch");
  });

  it("preserves nullable guidance status through canonical post-check hashing", () => {
    expect(canonicalExpectationResultRow({ ...reviewed.results[0], packageVersion: "3.3", guidanceStatus: null }).guidanceStatus).toBeNull();
  });

  it("derives HTTPS worker endpoints and gzip payloads without exposing the key", () => {
    expect(workerExpectationsApiUrl("/api/worker/backup-expectations", "https://example.test/api/worker/ingest?key=ignored")).toBe("https://example.test/api/worker/backup-expectations");
    expect(() => workerExpectationsApiUrl("/api/worker/backup-expectations", "http://example.test/api/worker/ingest")).toThrow("HTTPS");
    expect(JSON.parse(gunzipSync(gzipWorkerJson({ ok: true })).toString("utf8"))).toEqual({ ok: true });
  });
});
