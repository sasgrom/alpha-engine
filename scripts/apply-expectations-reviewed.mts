import "dotenv/config";
import path from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import { loadExpectationsReviewedPackage, type ExpectationsResultRow } from "./lib/expectations-reviewed-package";
import { assertBackupGate, defaultBackupRoot } from "./lib/prod-backup";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const apply = args.includes("--apply");
const backupId = option("--backup-id");
if (!backupId) {
  console.error("--backup-id is required; no database write is permitted without a verified backup");
  process.exit(1);
}
const sourceUrl = process.env.PROD_DATABASE_URL;
if (!sourceUrl) {
  console.error("PROD_DATABASE_URL is required; provision it without printing or committing the connection string");
  process.exit(1);
}
const reviewed = await loadExpectationsReviewedPackage(path.resolve(option("--package") ?? "research/reviewed-sync/2026-11-09/expectations-reviewed-v3.3.zip"));
const gateOptions = {
  backupId,
  backupRoot: defaultBackupRoot(),
  targetDatabaseUrl: sourceUrl,
  expectedTables: reviewed.tables,
};
const gate = assertBackupGate(gateOptions);

async function connect(): Promise<Connection> {
  try {
    return await mysql.createConnection({ uri: sourceUrl, multipleStatements: false });
  } catch {
    throw new Error("Unable to connect to the apply target; check PROD_DATABASE_URL without printing it");
  }
}

async function assertStagingTables(connection: Connection) {
  for (const table of reviewed.tables) {
    const [rows] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = ?", [table]);
    if ((rows as unknown[]).length !== 1) throw new Error(`Reviewed staging table is missing: ${table}; no DDL is performed by this apply`);
  }
}

function resultBatch(rows: ExpectationsResultRow[]) {
  const columns = "(packageVersion, cik, accessionNo, sourceId, containerId, inputSha256, sourceUrl, status, guidanceStatus, statements, extractionWarnings, rejectedEvidence)";
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = rows.flatMap((row) => [
    reviewed.manifest.packageVersion, row.cik, row.accessionNo, row.sourceId, row.containerId, row.inputSha256, row.sourceUrl,
    row.status, row.guidanceStatus, JSON.stringify(row.statements), JSON.stringify(row.extractionWarnings), row.rejectedEvidence,
  ]);
  return { sql: `INSERT INTO expectations_reviewed_results ${columns} VALUES ${placeholders} ON DUPLICATE KEY UPDATE packageVersion=VALUES(packageVersion), inputSha256=VALUES(inputSha256), sourceUrl=VALUES(sourceUrl), status=VALUES(status), guidanceStatus=VALUES(guidanceStatus), statements=VALUES(statements), extractionWarnings=VALUES(extractionWarnings), rejectedEvidence=VALUES(rejectedEvidence)`, values };
}

if (!apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    gate: "pass",
    backupId,
    manifestCreatedAt: gate.manifest.createdAt,
    restoreDrill: gate.drill.status,
    packageVersion: reviewed.manifest.packageVersion,
    results: reviewed.results.length,
    statements: reviewed.statements,
    tables: reviewed.tables,
    productionApply: false,
  }, null, 2));
} else {
  assertBackupGate({ ...gateOptions, now: new Date() });
  const connection = await connect();
  let resultRows = 0;
  try {
    await assertStagingTables(connection);
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO expectations_reviewed_packages (packageVersion, scope, normalizationVersion, productionApply, benchmarkEvaluationType, manifestJson, readinessJson) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE scope=VALUES(scope), normalizationVersion=VALUES(normalizationVersion), productionApply=VALUES(productionApply), benchmarkEvaluationType=VALUES(benchmarkEvaluationType), manifestJson=VALUES(manifestJson), readinessJson=VALUES(readinessJson)",
      [reviewed.manifest.packageVersion, reviewed.manifest.scope, reviewed.manifest.normalizationVersion, false, reviewed.manifest.benchmarkEvaluationType, JSON.stringify(reviewed.manifest), JSON.stringify(reviewed.readiness)],
    );
    for (let offset = 0; offset < reviewed.results.length; offset += 500) {
      const batch = resultBatch(reviewed.results.slice(offset, offset + 500));
      await connection.query(batch.sql, batch.values);
      resultRows += Math.min(500, reviewed.results.length - offset);
    }
    await connection.commit();
  } catch {
    await connection.rollback();
    throw new Error("Reviewed staging apply failed and was rolled back; no error details containing connection metadata were retained");
  } finally {
    await connection.end();
  }
  console.log(JSON.stringify({ mode: "staging-apply", gate: "pass", backupId, packageVersion: reviewed.manifest.packageVersion, resultRows, statements: reviewed.statements, productionApply: false }, null, 2));
}
