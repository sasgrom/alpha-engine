import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyWorkerKey: vi.fn(),
  createBackup: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../lib/env", () => ({ env: { databaseUrl: "mysql://unit:unit@db.example/production" } }));
vi.mock("../queries/connection", () => ({ getDb: () => { throw new Error("Unexpected real DB connection"); } }));
vi.mock("./worker", () => ({ verifyWorkerKey: mocks.verifyWorkerKey }));
vi.mock("./worker-expectations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worker-expectations")>();
  return { ...actual, createExpectationsBackup: mocks.createBackup, applyExpectationsReviewed: mocks.apply };
});

import { handleWorkerExpectationsBackup, readWorkerGzipJson } from "./worker-expectations-http";
import { EXPECTATIONS_APPLY_TABLES } from "../../contracts/expectations-apply";
import { loadExpectationsReviewedPackage } from "../../scripts/lib/expectations-reviewed-package";
import { sha256 } from "../../scripts/lib/prod-backup";
import { assertExpectationsPostCheck } from "../../scripts/lib/expectations-postcheck";
import { gzipWorkerJson } from "../../scripts/lib/worker-expectations-api";

const { applyExpectationsReviewed, createExpectationsBackup } = await vi.importActual<typeof import("./worker-expectations")>("./worker-expectations");
const identityHash = "a".repeat(64);
let reviewed: Awaited<ReturnType<typeof loadExpectationsReviewedPackage>>;
const input = () => ({
  manifestJson: reviewed.manifestJson,
  manifestSha256: sha256(reviewed.manifestJson),
  payloadJson: reviewed.payloadJson,
  readiness: reviewed.readiness,
  expectedDbIdentityHash: identityHash,
});

function queryText(query: any): string {
  return query.queryChunks.map((chunk: any) => {
    if (chunk.constructor.name === "StringChunk") return chunk.value.join("");
    return Array.isArray(chunk.queryChunks) ? queryText(chunk) : "";
  }).join("");
}

beforeEach(async () => {
  vi.clearAllMocks();
  reviewed ??= await loadExpectationsReviewedPackage("research/reviewed-sync/2026-11-09/expectations-reviewed-v3.4.zip");
});

describe("worker Expectations backup/apply channel", () => {
  it("returns 401 without a worker key", async () => {
    mocks.verifyWorkerKey.mockResolvedValue(null);
    const response = await handleWorkerExpectationsBackup(new Request("https://example.test/api/worker/backup-expectations", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.createBackup).not.toHaveBeenCalled();
  });

  it("uses read-only auth and gzip for backup responses", async () => {
    mocks.verifyWorkerKey.mockResolvedValue("test-worker");
    mocks.createBackup.mockResolvedValue({ manifest: { backupId: "backup" }, tables: [] });
    const response = await handleWorkerExpectationsBackup(new Request("https://example.test/api/worker/backup-expectations", { method: "POST", headers: { authorization: "Bearer unit" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"))).toEqual({ manifest: { backupId: "backup" }, tables: [] });
    expect(mocks.verifyWorkerKey).toHaveBeenCalledWith("Bearer unit", { touch: false });
  });

  it("creates a manifest using SELECT only and reports missing source tables", async () => {
    const statements: string[] = [];
    const db = {
      execute: async (query: any) => {
        statements.push(queryText(query));
        return [[]];
      },
    };
    const backup = await createExpectationsBackup({ db, identityHash, now: new Date("2026-11-09T20:00:00.000Z"), randomSuffix: "abcdef123456" });
    expect(backup.manifest.backupId).toBe("20261109T200000Z-abcdef123456");
    expect(backup.manifest.tables.map((table) => table.sourceExists)).toEqual([false, false]);
    expect(backup.manifest.tables.map((table) => table.rowCount)).toEqual([0, 0]);
    expect(statements).toHaveLength(1);
    expect(statements.every((statement) => statement.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("reports an existing source table with its actual row count and hashes", async () => {
    const statements: string[] = [];
    const db = {
      execute: async (query: any) => {
        const text = queryText(query);
        statements.push(text);
        if (text.includes("information_schema")) return [[{ TABLE_NAME: EXPECTATIONS_APPLY_TABLES[0] }]];
        if (text.includes("SELECT * FROM `expectations_reviewed_packages`")) return [[{ packageVersion: "3.3" }]];
        return [[]];
      },
    };
    const backup = await createExpectationsBackup({ db, identityHash, now: new Date("2026-11-09T20:00:00.000Z"), randomSuffix: "abcdef123456" });
    expect(backup.manifest.tables[0]).toMatchObject({ sourceExists: true, rowCount: 1 });
    expect(backup.manifest.tables[1]).toMatchObject({ sourceExists: false, rowCount: 0 });
    expect(statements.every((statement) => statement.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("rejects a bad package manifest hash", async () => {
    await expect(applyExpectationsReviewed({ manifestJson: "{}", manifestSha256: "bad", expectedDbIdentityHash: identityHash }, { db: {}, identityHash })).rejects.toMatchObject({ status: 400, message: "Reviewed package manifest hash mismatch" });
  });

  it("rejects the wrong database identity before validation or DB access", async () => {
    const db = { execute: vi.fn() };
    await expect(applyExpectationsReviewed(input(), { db, identityHash: "b".repeat(64) })).rejects.toMatchObject({ status: 409, message: "Apply database identity mismatch" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("returns all missing staging tables without starting a transaction", async () => {
    const db = { execute: vi.fn(async () => [[]]), transaction: vi.fn() };
    await expect(applyExpectationsReviewed(input(), { db, identityHash })).rejects.toMatchObject({ status: 409, details: { missing: EXPECTATIONS_APPLY_TABLES } });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns package-specific post-check hashes accepted by the independent verifier", async () => {
    const db = {
      execute: async (query: any) => {
        const text = queryText(query);
        if (text.includes("information_schema")) return [EXPECTATIONS_APPLY_TABLES.map((table) => ({ TABLE_NAME: table }))];
        if (text.startsWith("SELECT COUNT(*)")) return [[{ n: reviewed.results.length }]];
        if (text.includes("FROM `expectations_reviewed_results` WHERE packageVersion")) return [reviewed.results.map((row) => ({ ...row, packageVersion: reviewed.manifest.packageVersion }))];
        if (text.includes("FROM `expectations_reviewed_packages` WHERE packageVersion")) return [[{
          packageVersion: reviewed.manifest.packageVersion,
          scope: reviewed.manifest.scope,
          normalizationVersion: reviewed.manifest.normalizationVersion,
          productionApply: 0,
          benchmarkEvaluationType: reviewed.manifest.benchmarkEvaluationType,
          manifestJson: reviewed.manifest,
          readinessJson: reviewed.readiness,
        }]];
        return [[]];
      },
      transaction: async (callback: (transaction: { execute: () => Promise<any[]> }) => Promise<void>) => callback({ execute: async () => [{ affectedRows: 1 }] }),
    };
    const response = await applyExpectationsReviewed(input(), { db, identityHash });
    expect(() => assertExpectationsPostCheck(response, reviewed)).not.toThrow();
  });

  it("rolls back the transaction when a middle result batch fails", async () => {
    let rolledBack = false;
    let writes = 0;
    const tx = {
      execute: vi.fn(async () => {
        writes++;
        if (writes === 3) throw new Error("synthetic middle-batch failure");
        return [{ affectedRows: 500 }];
      }),
    };
    const db = {
      execute: vi.fn(async () => [EXPECTATIONS_APPLY_TABLES.map((table) => ({ TABLE_NAME: table }))]),
      transaction: async (callback: (transaction: typeof tx) => Promise<void>) => {
        try {
          await callback(tx);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    };
    await expect(applyExpectationsReviewed(input(), { db, identityHash })).rejects.toThrow("synthetic middle-batch failure");
    expect(writes).toBe(3);
    expect(rolledBack).toBe(true);
  });

  it("round-trips gzip JSON request bodies", async () => {
    const value = { packageVersion: "3.3", results: [{ cik: 1045810 }] };
    const request = new Request("https://example.test/api/worker/apply-expectations-reviewed", {
      method: "POST",
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
      body: gzipWorkerJson(value),
    });
    expect(await readWorkerGzipJson(request)).toEqual(value);
  });
});
