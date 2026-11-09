import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export const BACKUP_TOOL_VERSION = "prod-backup-v1";
export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
export const EXPECTATIONS_APPLY_TABLES = ["expectations_reviewed_packages", "expectations_reviewed_results"] as const;

export interface BackupTableManifest {
  table: string;
  sourceExists: boolean;
  path: string;
  rowCount: number;
  bytes: number;
  sha256: string;
  contentSha256: string;
}

export interface RestoreDrillTableEvidence {
  table: string;
  restoredTable: string;
  sourceRowCount: number;
  restoredRowCount: number;
  sourceContentSha256: string;
  restoredContentSha256: string;
  pass: boolean;
}

export interface RestoreDrillEvidence {
  schemaVersion: 1;
  backupId: string;
  verifiedAt: string;
  sourceDbIdentityHash: string;
  targetDbIdentityHash: string;
  status: "pass" | "fail";
  tables: RestoreDrillTableEvidence[];
}

export interface ProdBackupManifest {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  dbIdentityHash: string;
  scope: "expectations" | "full";
  packageVersion?: string;
  packageSha256?: string;
  toolVersion: string;
  tables: BackupTableManifest[];
  restoreDrill: {
    verified: boolean;
    status: "pending" | "pass" | "fail";
    evidencePath?: string;
    evidenceSha256?: string;
    targetDbIdentityHash?: string;
    verifiedAt?: string;
  };
}

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function databaseIdentityHash(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Database URL is invalid");
  }
  const schema = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (parsed.protocol !== "mysql:" || !parsed.hostname || !schema || schema.includes("/")) {
    throw new Error("Database URL must identify one MySQL schema");
  }
  return sha256(`${parsed.hostname.toLowerCase()}/${schema}`);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function tableContentSha256(rows: unknown[]): string {
  const jsonRows = JSON.parse(JSON.stringify(rows)) as unknown[];
  const rowHashes = jsonRows.map((row) => sha256(JSON.stringify(stableValue(row)))).sort();
  return sha256(rowHashes.join("\n"));
}

export function assertReadOnlySql(statement: string): void {
  if (!/^SELECT\b/i.test(statement.trim()) || statement.includes(";")) {
    throw new Error("Backup connection refused a non-SELECT statement");
  }
}

export function defaultBackupRoot(): string {
  if (process.env.ALPHA_BACKUP_ROOT) return path.resolve(process.env.ALPHA_BACKUP_ROOT);
  return process.platform === "win32" ? path.resolve("D:\\alpha-engine\\backups\\prod") : path.resolve("../alpha-engine-backups/prod");
}

export function assertBackupRootOutsideRepository(root: string, repositoryRoot: string): void {
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(root));
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Backup root must be outside the Git repository");
  }
}

export function assertBackupId(backupId: string): void {
  if (!/^\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(backupId)) throw new Error("Invalid backup id");
}

function readJson(file: string): any {
  if (!existsSync(file)) throw new Error("Backup manifest or evidence is missing");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function verifyBackupManifest(backupDir: string): ProdBackupManifest {
  const manifest = readJson(path.join(backupDir, "manifest.json")) as ProdBackupManifest;
  assertBackupId(manifest.backupId);
  if (path.basename(path.resolve(backupDir)) !== manifest.backupId || manifest.schemaVersion !== 1 || manifest.toolVersion !== BACKUP_TOOL_VERSION) {
    throw new Error("Backup manifest identity or tool version is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.dbIdentityHash) || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.tables)) {
    throw new Error("Backup manifest metadata is invalid");
  }
  const tableNames = new Set<string>();
  for (const table of manifest.tables) {
    if (!/^[a-z0-9_]+$/.test(table.table) || tableNames.has(table.table) || table.path !== `tables/${table.table}.json`) {
      throw new Error("Backup manifest table scope is invalid");
    }
    tableNames.add(table.table);
    const file = path.join(backupDir, table.path);
    if (!existsSync(file)) throw new Error(`Backup table payload is missing: ${table.table}`);
    const bytes = readFileSync(file);
    const payload = JSON.parse(bytes.toString("utf8"));
    if (bytes.length !== table.bytes || sha256(bytes) !== table.sha256) throw new Error(`Backup table hash mismatch: ${table.table}`);
    if (!Array.isArray(payload.rows) || payload.table !== table.table || payload.sourceExists !== table.sourceExists) {
      throw new Error(`Backup table payload is invalid: ${table.table}`);
    }
    if (payload.rows.length !== table.rowCount || tableContentSha256(payload.rows) !== table.contentSha256) {
      throw new Error(`Backup table content hash mismatch: ${table.table}`);
    }
  }
  return manifest;
}

export function verifyRestoreDrill(backupDir: string, manifest: ProdBackupManifest): RestoreDrillEvidence {
  const drill = manifest.restoreDrill;
  if (!drill?.verified || drill.status !== "pass" || drill.evidencePath !== "restore-drill.json" || !/^[a-f0-9]{64}$/.test(drill.evidenceSha256 ?? "")) {
    throw new Error("Verified restore-drill evidence is missing");
  }
  const evidenceBytes = readFileSync(path.join(backupDir, drill.evidencePath));
  if (sha256(evidenceBytes) !== drill.evidenceSha256) throw new Error("Restore-drill evidence hash mismatch");
  const evidence = JSON.parse(evidenceBytes.toString("utf8")) as RestoreDrillEvidence;
  if (evidence.schemaVersion !== 1 || evidence.backupId !== manifest.backupId || evidence.status !== "pass" || evidence.sourceDbIdentityHash !== manifest.dbIdentityHash) {
    throw new Error("Restore-drill evidence identity mismatch");
  }
  if (!evidence.targetDbIdentityHash || evidence.targetDbIdentityHash === evidence.sourceDbIdentityHash || evidence.targetDbIdentityHash !== drill.targetDbIdentityHash) {
    throw new Error("Restore target must differ from the backup source");
  }
  const evidenceTables = new Map(evidence.tables.map((table) => [table.table, table]));
  if (evidenceTables.size !== manifest.tables.length) throw new Error("Restore-drill table coverage mismatch");
  for (const table of manifest.tables) {
    const restored = evidenceTables.get(table.table);
    if (!restored?.pass || restored.sourceRowCount !== table.rowCount || restored.restoredRowCount !== table.rowCount ||
      restored.sourceContentSha256 !== table.contentSha256 || restored.restoredContentSha256 !== table.contentSha256) {
      throw new Error(`Restore-drill verification failed: ${table.table}`);
    }
  }
  return evidence;
}

export function assertBackupGate(options: {
  backupId: string;
  backupRoot: string;
  targetDatabaseUrl: string;
  expectedTables?: readonly string[];
  now?: Date;
}): { backupDir: string; manifest: ProdBackupManifest; drill: RestoreDrillEvidence } {
  assertBackupId(options.backupId);
  const backupDir = path.join(options.backupRoot, options.backupId);
  const manifest = verifyBackupManifest(backupDir);
  const now = options.now ?? new Date();
  const age = now.getTime() - Date.parse(manifest.createdAt);
  if (age < 0 || age > BACKUP_MAX_AGE_MS) throw new Error("Backup is stale or dated in the future");
  if (manifest.dbIdentityHash !== databaseIdentityHash(options.targetDatabaseUrl)) throw new Error("Backup database identity does not match the apply target");
  if (options.expectedTables) {
    const actual = manifest.tables.map((table) => table.table).sort();
    const expected = [...options.expectedTables].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Backup table scope does not match the apply scope");
  }
  const drill = verifyRestoreDrill(backupDir, manifest);
  return { backupDir, manifest, drill };
}

export function pruneBackups(backupRoot: string, retain = 10): string[] {
  if (!existsSync(backupRoot)) return [];
  const backups = readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const manifest = verifyBackupManifest(path.join(backupRoot, entry.name));
    return { backupId: entry.name, createdAt: Date.parse(manifest.createdAt) };
  }).sort((a, b) => b.createdAt - a.createdAt);
  const removed = backups.slice(retain).map((entry) => entry.backupId);
  for (const backupId of removed) rmSync(path.join(backupRoot, backupId), { recursive: true, force: false });
  return removed;
}
