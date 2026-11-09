import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import { loadExpectationsReviewedPackage } from "./lib/expectations-reviewed-package";
import {
  BACKUP_TOOL_VERSION,
  EXPECTATIONS_APPLY_TABLES,
  assertBackupRootOutsideRepository,
  assertReadOnlySql,
  databaseIdentityHash,
  defaultBackupRoot,
  pruneBackups,
  sha256,
  tableContentSha256,
  verifyBackupManifest,
  verifyRestoreDrill,
  type ProdBackupManifest,
  type RestoreDrillTableEvidence,
} from "./lib/prod-backup";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const backupRoot = defaultBackupRoot();
const writeAtomic = (file: string, value: unknown) => {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
};

async function selectRows(connection: Connection, statement: string, params: unknown[] = []): Promise<any[]> {
  assertReadOnlySql(statement);
  try {
    const [rows] = await connection.query(statement, params);
    return rows as any[];
  } catch {
    throw new Error("A SELECT query failed; no backup or restore write was attempted on the source");
  }
}

async function connect(databaseUrl: string, role: "source" | "scratch"): Promise<Connection> {
  try {
    return await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
  } catch {
    throw new Error(`Unable to connect to the ${role} database; check the provisioned environment variable`);
  }
}

function requiredDatabaseUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; provision it without printing or committing the connection string`);
  return value;
}

function restoreTableName(backupId: string, table: string): string {
  return `drill_${backupId.slice(-12)}_${sha256(table).slice(0, 12)}`;
}

async function runRestoreDrill(backupDir: string, manifest: ProdBackupManifest, targetEnvName: string) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(targetEnvName) || targetEnvName === "PROD_DATABASE_URL") {
    throw new Error("--restore-target must name a SCRATCH database URL environment variable, not PROD_DATABASE_URL");
  }
  const targetUrl = requiredDatabaseUrl(targetEnvName);
  const targetIdentity = databaseIdentityHash(targetUrl);
  if (targetIdentity === manifest.dbIdentityHash) throw new Error("Restore target must differ from the backup source");
  const scratch = await connect(targetUrl, "scratch");
  const tables: RestoreDrillTableEvidence[] = [];
  try {
    for (const table of manifest.tables) {
      const restoredTable = restoreTableName(manifest.backupId, table.table);
      const existing = await selectRows(scratch, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [restoredTable]);
      if (existing.length) throw new Error(`Restore drill table already exists for ${table.table}; refusing to overwrite it`);
      const payload = JSON.parse(readFileSync(path.join(backupDir, table.path), "utf8"));
      try {
        await scratch.query(`CREATE TABLE \`${restoredTable}\` (ordinal BIGINT NOT NULL PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB`);
      } catch {
        throw new Error(`Unable to create a new restore-drill table for ${table.table}`);
      }
      for (let offset = 0; offset < payload.rows.length; offset += 500) {
        const batch = payload.rows.slice(offset, offset + 500);
        const placeholders = batch.map(() => "(?, ?)").join(", ");
        const params = batch.flatMap((row: unknown, index: number) => [offset + index, JSON.stringify(row)]);
        try {
          await scratch.query(`INSERT INTO \`${restoredTable}\` (ordinal, payload) VALUES ${placeholders}`, params);
        } catch {
          throw new Error(`Unable to insert restore-drill rows for ${table.table}`);
        }
      }
      const restoredRows = await selectRows(scratch, `SELECT ordinal, payload FROM \`${restoredTable}\` ORDER BY ordinal`);
      const normalizedRows = restoredRows.sort((a, b) => Number(a.ordinal) - Number(b.ordinal)).map((row) => typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload);
      const restoredContentSha256 = tableContentSha256(normalizedRows);
      tables.push({
        table: table.table,
        restoredTable,
        sourceRowCount: table.rowCount,
        restoredRowCount: normalizedRows.length,
        sourceContentSha256: table.contentSha256,
        restoredContentSha256,
        pass: normalizedRows.length === table.rowCount && restoredContentSha256 === table.contentSha256,
      });
    }
  } finally {
    await scratch.end();
  }
  const pass = tables.every((table) => table.pass);
  const evidence = {
    schemaVersion: 1 as const,
    backupId: manifest.backupId,
    verifiedAt: new Date().toISOString(),
    sourceDbIdentityHash: manifest.dbIdentityHash,
    targetDbIdentityHash: targetIdentity,
    status: pass ? "pass" as const : "fail" as const,
    tables,
  };
  writeAtomic(path.join(backupDir, "restore-drill.json"), evidence);
  manifest.restoreDrill = {
    verified: pass,
    status: pass ? "pass" : "fail",
    evidencePath: "restore-drill.json",
    evidenceSha256: sha256(readFileSync(path.join(backupDir, "restore-drill.json"))),
    targetDbIdentityHash: targetIdentity,
    verifiedAt: evidence.verifiedAt,
  };
  writeAtomic(path.join(backupDir, "manifest.json"), manifest);
  if (pass) verifyRestoreDrill(backupDir, verifyBackupManifest(backupDir));
  return evidence;
}

async function main() {
  assertBackupRootOutsideRepository(backupRoot, ROOT);
  if (args.includes("--prune")) {
    const removed = pruneBackups(backupRoot, 10);
    console.log(JSON.stringify({ pruned: removed, retained: 10 }, null, 2));
    return;
  }
  const restoreTarget = option("--restore-target");
  const existingBackupId = option("--backup-id");
  let backupDir: string;
  let manifest: ProdBackupManifest;
  if (existingBackupId) {
    backupDir = path.join(backupRoot, existingBackupId);
    manifest = verifyBackupManifest(backupDir);
    if (!restoreTarget) throw new Error("--restore-target is required when running a drill for an existing backup");
  } else {
    const sourceEnv = option("--source-env") ?? "PROD_DATABASE_URL";
    if (!/^[A-Z][A-Z0-9_]*$/.test(sourceEnv) || sourceEnv === restoreTarget) throw new Error("--source-env must name a source database URL environment variable distinct from the restore target");
    const sourceUrl = requiredDatabaseUrl(sourceEnv);
    const full = args.includes("--full");
    let packageVersion: string | undefined;
    let packageSha256: string | undefined;
    let tables: string[];
    if (full) {
      tables = [];
      packageVersion = undefined;
    } else {
      const reviewed = await loadExpectationsReviewedPackage(path.resolve(option("--package") ?? "research/reviewed-sync/2026-11-09/expectations-reviewed-v3.3.zip"));
      packageVersion = reviewed.manifest.packageVersion;
      packageSha256 = reviewed.packageSha256;
      tables = [...reviewed.tables];
    }
    const source = await connect(sourceUrl, "source");
    const createdAt = new Date().toISOString();
    const backupId = `${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${sha256(`${createdAt}:${randomBytes(16).toString("hex")}`).slice(0, 12)}`;
    backupDir = path.join(backupRoot, backupId);
    if (existsSync(backupDir)) throw new Error("Backup id collision; refusing to overwrite");
    mkdirSync(path.join(backupDir, "tables"), { recursive: true });
    try {
      if (full) {
        tables = (await selectRows(source, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")).map((row) => row.TABLE_NAME);
      }
      const tableManifests = [];
      for (const table of tables) {
        if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Unsafe table name returned by the source");
        const exists = await selectRows(source, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = ?", [table]);
        const rows = exists.length ? await selectRows(source, `SELECT * FROM \`${table}\``) : [];
        const relativePath = `tables/${table}.json`;
        writeAtomic(path.join(backupDir, relativePath), { table, sourceExists: exists.length === 1, rows });
        const bytes = readFileSync(path.join(backupDir, relativePath));
        tableManifests.push({
          table,
          sourceExists: exists.length === 1,
          path: relativePath,
          rowCount: rows.length,
          bytes: bytes.length,
          sha256: sha256(bytes),
          contentSha256: tableContentSha256(rows),
        });
      }
      manifest = {
        schemaVersion: 1,
        backupId,
        createdAt,
        dbIdentityHash: databaseIdentityHash(sourceUrl),
        scope: full ? "full" : "expectations",
        packageVersion,
        packageSha256,
        toolVersion: BACKUP_TOOL_VERSION,
        tables: tableManifests,
        restoreDrill: { verified: false, status: "pending" },
      };
      writeAtomic(path.join(backupDir, "manifest.json"), manifest);
      verifyBackupManifest(backupDir);
    } finally {
      await source.end();
    }
  }
  let drill;
  if (restoreTarget) drill = await runRestoreDrill(backupDir, manifest!, restoreTarget);
  const verified = verifyBackupManifest(backupDir);
  const manifestSha256 = sha256(readFileSync(path.join(backupDir, "manifest.json")));
  console.log(JSON.stringify({
    backupId: verified.backupId,
    backupDir,
    manifestSha256,
    dbIdentityHash: verified.dbIdentityHash,
    scope: verified.scope,
    tables: verified.tables.map((table) => ({
      table: table.table,
      sourceExists: table.sourceExists,
      rows: table.rowCount,
      bytes: table.bytes,
      sha256: table.sha256,
      restore: drill?.tables.find((item) => item.table === table.table) ?? null,
    })),
    restoreDrill: verified.restoreDrill,
  }, null, 2));
  console.log(`${verified.restoreDrill.verified ? "BACKUP_VERIFIED" : "BACKUP_UNVERIFIED"} backupId=${verified.backupId} manifestSha256=${manifestSha256}`);
  if (restoreTarget && !verified.restoreDrill.verified) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backup channel failed");
  process.exitCode = 1;
});
