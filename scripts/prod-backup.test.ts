import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeZipEntryPath } from "./lib/expectations-reviewed-package";
import {
  BACKUP_TOOL_VERSION,
  EXPECTATIONS_APPLY_TABLES,
  assertBackupGate,
  assertBackupRootOutsideRepository,
  assertReadOnlySql,
  databaseIdentityHash,
  sha256,
  tableContentSha256,
  verifyBackupManifest,
  type ProdBackupManifest,
} from "./lib/prod-backup";

const sourceUrl = "mysql://backup-user:secret@source.example/production";
const backupId = "20261109T050000Z-abcdef123456";
let root: string;
let backupDir: string;
let manifest: ProdBackupManifest;

function writeEvidence(verifiedAt = new Date().toISOString()) {
  const evidence = {
    schemaVersion: 1,
    backupId,
    verifiedAt,
    sourceDbIdentityHash: manifest.dbIdentityHash,
    targetDbIdentityHash: databaseIdentityHash("mysql://scratch-user:secret@127.0.0.1/restore_scratch"),
    status: "pass",
    tables: manifest.tables.map((table) => ({
      table: table.table,
      restoredTable: `drill_${table.table}`,
      sourceRowCount: table.rowCount,
      restoredRowCount: table.rowCount,
      sourceContentSha256: table.contentSha256,
      restoredContentSha256: table.contentSha256,
      pass: true,
    })),
  };
  writeFileSync(path.join(backupDir, "restore-drill.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  manifest.restoreDrill = {
    verified: true,
    status: "pass",
    evidencePath: "restore-drill.json",
    evidenceSha256: sha256(readFileSync(path.join(backupDir, "restore-drill.json"))),
    targetDbIdentityHash: evidence.targetDbIdentityHash,
    verifiedAt,
  };
  writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "alpha-prod-backup-"));
  backupDir = path.join(root, backupId);
  const rows = [{ cik: 1045810, payload: { value: 1 } }, { cik: 1018724, payload: { value: 2 } }];
  const tableBytes = Buffer.from(`${JSON.stringify({ table: EXPECTATIONS_APPLY_TABLES[1], sourceExists: true, rows }, null, 2)}\n`);
  const emptyBytes = Buffer.from(`${JSON.stringify({ table: EXPECTATIONS_APPLY_TABLES[0], sourceExists: false, rows: [] }, null, 2)}\n`);
  manifest = {
    schemaVersion: 1,
    backupId,
    createdAt: new Date().toISOString(),
    dbIdentityHash: databaseIdentityHash(sourceUrl),
    scope: "expectations",
    packageVersion: "3.3",
    toolVersion: BACKUP_TOOL_VERSION,
    tables: [
      { table: EXPECTATIONS_APPLY_TABLES[0], sourceExists: false, path: "tables/expectations_reviewed_packages.json", rowCount: 0, bytes: emptyBytes.length, sha256: sha256(emptyBytes), contentSha256: tableContentSha256([]) },
      { table: EXPECTATIONS_APPLY_TABLES[1], sourceExists: true, path: "tables/expectations_reviewed_results.json", rowCount: rows.length, bytes: tableBytes.length, sha256: sha256(tableBytes), contentSha256: tableContentSha256(rows) },
    ],
    restoreDrill: { verified: false, status: "pending" },
  };
  mkdirSync(path.join(backupDir, "tables"), { recursive: true });
  writeFileSync(path.join(backupDir, "tables/expectations_reviewed_results.json"), tableBytes);
  writeFileSync(path.join(backupDir, "tables/expectations_reviewed_packages.json"), emptyBytes);
  writeEvidence();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const gate = () => ({ backupId, backupRoot: root, targetDatabaseUrl: sourceUrl, expectedTables: EXPECTATIONS_APPLY_TABLES });

describe("reviewed production backup gate", () => {
  it("verifies manifest hashes and successful restore-drill evidence", () => {
    expect(verifyBackupManifest(backupDir).backupId).toBe(backupId);
    expect(() => assertBackupGate(gate())).not.toThrow();
  });

  it("refuses a table hash mismatch", () => {
    writeFileSync(path.join(backupDir, "tables/expectations_reviewed_results.json"), "{}\n");
    expect(() => assertBackupGate(gate())).toThrow("hash mismatch");
  });

  it("refuses a stale backup", () => {
    manifest.createdAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest));
    expect(() => assertBackupGate(gate())).toThrow("stale");
  });

  it("refuses a different target database identity", () => {
    expect(() => assertBackupGate({ ...gate(), targetDatabaseUrl: "mysql://user:secret@source.example/another_schema" })).toThrow("identity");
  });

  it("refuses missing or mismatched restore-drill evidence", () => {
    rmSync(path.join(backupDir, "restore-drill.json"));
    expect(() => assertBackupGate(gate())).toThrow();
  });

  it("canonicalizes MySQL dates and row order for restore content hashes", () => {
    const date = new Date("2026-11-09T05:00:00.000Z");
    const fromDriver = [{ id: 1, createdAt: date }, { id: 2, createdAt: date }];
    const restored = [{ id: 2, createdAt: "2026-11-09T05:00:00.000Z" }, { id: 1, createdAt: "2026-11-09T05:00:00.000Z" }];
    expect(tableContentSha256(fromDriver)).toBe(tableContentSha256(restored));
  });

  it("normalizes PowerShell ZIP entry separators for package verification", () => {
    expect(normalizeZipEntryPath("qa\\AMZN.json")).toBe("qa/AMZN.json");
  });

  it("allows SELECT only and requires an external backup root", () => {
    expect(() => assertReadOnlySql("SELECT * FROM prices")).not.toThrow();
    for (const statement of ["DELETE FROM prices", "UPDATE prices SET close=0", "DROP TABLE prices", "SELECT 1; SELECT 2"]) {
      expect(() => assertReadOnlySql(statement)).toThrow("non-SELECT");
    }
    expect(() => assertBackupRootOutsideRepository(root, path.join(root, "repository"))).not.toThrow();
    expect(() => assertBackupRootOutsideRepository(path.join(root, "repository/backups"), path.join(root, "repository"))).toThrow("outside");
  });
});
