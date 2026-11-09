import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import {
  EXPECTATIONS_APPLY_TABLES,
  EXPECTATIONS_REVIEWED_MANIFEST_SHA256,
  EXPECTATIONS_REVIEWED_PACKAGE_SHA256,
  EXPECTATIONS_REVIEWED_PACKAGE_VERSION,
  canonicalExpectationPackageRow,
  canonicalExpectationResultRow,
  expectationResultKey,
  expectationResultSamples,
  type ExpectationsApplyResultRow,
} from "../../contracts/expectations-apply";
import {
  BACKUP_TOOL_VERSION,
  databaseIdentityHash,
  serializeBackupTablePayload,
  sha256,
  tableContentSha256,
  type ProdBackupManifest,
} from "../../scripts/lib/prod-backup";

export class ReviewedApplyError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function rowsOf(db: any, query: SQL): Promise<any[]> {
  const result = await db.execute(query);
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

async function existingTables(db: any): Promise<string[]> {
  const rows = await rowsOf(db, sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME IN (${EXPECTATIONS_APPLY_TABLES[0]}, ${EXPECTATIONS_APPLY_TABLES[1]})`);
  return rows.map((row) => row.TABLE_NAME);
}

export async function createExpectationsBackup(options: { db?: any; identityHash?: string; now?: Date; randomSuffix?: string } = {}) {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const backupId = `${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${options.randomSuffix ?? sha256(`${createdAt}:${randomBytes(16).toString("hex")}`).slice(0, 12)}`;
  const present = new Set(await existingTables(db));
  const tables = [];
  const payloads = [];
  for (const table of EXPECTATIONS_APPLY_TABLES) {
    const rows = present.has(table) ? await rowsOf(db, sql.raw(`SELECT * FROM \`${table}\``)) : [];
    const payload = { table, sourceExists: present.has(table), rows };
    const bytes = serializeBackupTablePayload(payload);
    tables.push({ table, sourceExists: payload.sourceExists, path: `tables/${table}.json`, rowCount: rows.length, bytes: bytes.length, sha256: sha256(bytes), contentSha256: tableContentSha256(rows) });
    payloads.push(payload);
  }
  const manifest: ProdBackupManifest = {
    schemaVersion: 1,
    backupId,
    createdAt,
    dbIdentityHash: options.identityHash ?? databaseIdentityHash(env.databaseUrl),
    scope: "expectations",
    packageVersion: EXPECTATIONS_REVIEWED_PACKAGE_VERSION,
    packageSha256: EXPECTATIONS_REVIEWED_PACKAGE_SHA256,
    toolVersion: BACKUP_TOOL_VERSION,
    tables,
    restoreDrill: { verified: false, status: "pending" },
  };
  return { manifest, tables: payloads };
}

function validateApplyInput(input: any) {
  if (typeof input?.manifestJson !== "string" || input.manifestSha256 !== EXPECTATIONS_REVIEWED_MANIFEST_SHA256 || sha256(input.manifestJson) !== EXPECTATIONS_REVIEWED_MANIFEST_SHA256) {
    throw new ReviewedApplyError(400, "Reviewed package manifest hash mismatch");
  }
  const manifest = JSON.parse(input.manifestJson);
  if (manifest.packageVersion !== EXPECTATIONS_REVIEWED_PACKAGE_VERSION || manifest.applyPayload !== "expectations-results.json" || manifest.productionApply !== false) {
    throw new ReviewedApplyError(400, "Reviewed package metadata mismatch");
  }
  const payloadFile = manifest.files.find((file: any) => file.path === "expectations-results.json");
  if (typeof input.payloadJson !== "string" || !payloadFile || sha256(input.payloadJson) !== payloadFile.sha256) {
    throw new ReviewedApplyError(400, "Reviewed exact-key payload hash mismatch");
  }
  const payload = JSON.parse(input.payloadJson);
  if (payload.packageVersion !== EXPECTATIONS_REVIEWED_PACKAGE_VERSION || payload.resultKeyDefinition !== "(cik, accessionNo, sourceId, containerId)" || !Array.isArray(payload.results) || payload.results.length !== manifest.documents) {
    throw new ReviewedApplyError(400, "Reviewed result count mismatch");
  }
  const keys = new Set<string>();
  let statements = 0;
  for (const row of payload.results as ExpectationsApplyResultRow[]) {
    const key = expectationResultKey(row);
    if (keys.has(key)) throw new ReviewedApplyError(400, "Duplicate exact result key");
    keys.add(key);
    if (!Array.isArray(row.statements) || !Array.isArray(row.extractionWarnings) || !/^https:\/\/www\.sec\.gov\/Archives\//.test(row.sourceUrl)) {
      throw new ReviewedApplyError(400, "Invalid reviewed result row");
    }
    statements += row.statements.length;
  }
  if (statements !== manifest.counts.outputStatements || !input.readiness || typeof input.readiness !== "object") throw new ReviewedApplyError(400, "Reviewed statement count or readiness mismatch");
  return { manifest, readiness: input.readiness, results: payload.results as ExpectationsApplyResultRow[], statements };
}

export async function postCheckExpectationsReviewed(packageVersion: string, db: any = getDb()) {
  const tableChecks = [];
  for (const table of EXPECTATIONS_APPLY_TABLES) {
    const [count] = await rowsOf(db, sql.raw(`SELECT COUNT(*) AS n FROM \`${table}\``));
    const packageRows = await rowsOf(db, sql`SELECT * FROM ${sql.raw(`\`${table}\``)} WHERE packageVersion = ${packageVersion}`);
    const canonicalRows = packageRows.map((row) => table === "expectations_reviewed_results" ? canonicalExpectationResultRow(row) : canonicalExpectationPackageRow(row));
    const samples = table === "expectations_reviewed_results" ? expectationResultSamples(packageRows) : packageRows;
    tableChecks.push({
      table,
      rows: Number(count?.n ?? 0),
      packageRows: packageRows.length,
      contentSha256: tableContentSha256(canonicalRows),
      sampleContentHashes: samples.map((row) => ({
        key: table === "expectations_reviewed_results" ? expectationResultKey(row) : packageVersion,
        sha256: tableContentSha256([table === "expectations_reviewed_results" ? canonicalExpectationResultRow(row) : canonicalExpectationPackageRow(row)]),
      })),
      statements: table === "expectations_reviewed_results" ? canonicalRows.reduce((sum: number, row: any) => sum + row.statements.length, 0) : undefined,
    });
  }
  return { packageVersion, tables: tableChecks };
}

export async function applyExpectationsReviewed(input: any, options: { db?: any; identityHash?: string } = {}) {
  const db = options.db ?? getDb();
  const identity = options.identityHash ?? databaseIdentityHash(env.databaseUrl);
  if (input?.expectedDbIdentityHash !== identity) throw new ReviewedApplyError(409, "Apply database identity mismatch");
  const validated = validateApplyInput(input);
  const present = new Set(await existingTables(db));
  const missing = EXPECTATIONS_APPLY_TABLES.filter((table) => !present.has(table));
  if (missing.length) throw new ReviewedApplyError(409, "Reviewed staging tables are missing", { missing });
  const packageVersion = EXPECTATIONS_REVIEWED_PACKAGE_VERSION;
  await db.transaction(async (tx: any) => {
    await tx.execute(sql`INSERT INTO expectations_reviewed_packages (packageVersion, scope, normalizationVersion, productionApply, benchmarkEvaluationType, manifestJson, readinessJson) VALUES (${packageVersion}, ${validated.manifest.scope}, ${validated.manifest.normalizationVersion}, ${false}, ${validated.manifest.benchmarkEvaluationType}, ${input.manifestJson}, ${JSON.stringify(validated.readiness)}) ON DUPLICATE KEY UPDATE scope=VALUES(scope), normalizationVersion=VALUES(normalizationVersion), productionApply=VALUES(productionApply), benchmarkEvaluationType=VALUES(benchmarkEvaluationType), manifestJson=VALUES(manifestJson), readinessJson=VALUES(readinessJson)`);
    for (let offset = 0; offset < validated.results.length; offset += 500) {
      const batch = validated.results.slice(offset, offset + 500);
      const values = batch.map((row) => sql`(${packageVersion}, ${row.cik}, ${row.accessionNo}, ${row.sourceId}, ${row.containerId}, ${row.inputSha256}, ${row.sourceUrl}, ${row.status}, ${row.guidanceStatus}, ${JSON.stringify(row.statements)}, ${JSON.stringify(row.extractionWarnings)}, ${row.rejectedEvidence})`);
      await tx.execute(sql`INSERT INTO expectations_reviewed_results (packageVersion, cik, accessionNo, sourceId, containerId, inputSha256, sourceUrl, status, guidanceStatus, statements, extractionWarnings, rejectedEvidence) VALUES ${sql.join(values, sql`, `)} ON DUPLICATE KEY UPDATE packageVersion=VALUES(packageVersion), inputSha256=VALUES(inputSha256), sourceUrl=VALUES(sourceUrl), status=VALUES(status), guidanceStatus=VALUES(guidanceStatus), statements=VALUES(statements), extractionWarnings=VALUES(extractionWarnings), rejectedEvidence=VALUES(rejectedEvidence)`);
    }
  });
  const postCheck = await postCheckExpectationsReviewed(packageVersion, db);
  return { packageVersion, results: validated.results.length, statements: validated.statements, postCheck };
}
