import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { documents, filings } from "@db/schema";
import { workerDocumentSnapshotRowZ, type WorkerDocumentSnapshotRow } from "../api/services/document-ingest";

const ZIP = path.resolve("research/reviewed-sync/2026-11-06/documents-metadata-full.zip");
const EXPECTED_ZIP_SHA256 = "99229d35b168439ad9425ae252ce29700236bbf5912fc01f1af0b5e693d0b236";
const EXPECTED_ROWS = 39_801;
const BATCH_SIZE = 500;
const apply = process.argv.includes("--apply");
const db = getDb();
const outDir = path.resolve(`worker/.runs/documents-metadata-apply-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(outDir, { recursive: true });
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const readZip = (name: string) => execFileSync("unzip", ["-p", ZIP, name], { maxBuffer: 64 * 1024 * 1024 });
const keyOf = (row: { cik: number; accessionNo: string; docName: string }) => `${row.cik}|${row.accessionNo}|${row.docName}`;
const countBy = <T extends string>(rows: WorkerDocumentSnapshotRow[], field: "form" | "role") => {
  const result: Record<string, number> = {};
  for (const row of rows) result[row[field]] = (result[row[field]] ?? 0) + 1;
  return result;
};
const addCounts = (left: Record<string, number>, right: Record<string, number>) => {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = (result[key] ?? 0) + value;
  return result;
};
const sameCounts = (left: Record<string, number>, right: Record<string, number>) => {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => (left[key] ?? 0) === (right[key] ?? 0));
};
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

try {
  const zipBytes = readFileSyncBytes(ZIP);
  if (sha256(zipBytes) !== EXPECTED_ZIP_SHA256) throw new Error("Metadata ZIP SHA256 mismatch");
  const manifest = JSON.parse(readZip("manifest.json").toString("utf8"));
  const validation = JSON.parse(readZip("documents-snapshot-validation.json").toString("utf8"));
  const snapshotBytes = readZip("documents-snapshot.json");
  for (const file of manifest.files ?? []) {
    const bytes = readZip(file.path);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`ZIP entry hash mismatch: ${file.path}`);
  }
  if (validation.status !== "pass" || validation.errors?.length) throw new Error("Local dry-run did not pass");
  const parsed = JSON.parse(snapshotBytes.toString("utf8"));
  const rows = parsed.rows.map((row: unknown) => workerDocumentSnapshotRowZ.parse(row));
  if (rows.length !== EXPECTED_ROWS || manifest.documentsSelected !== EXPECTED_ROWS) throw new Error("Unexpected metadata row count");
  const exactKeys = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (exactKeys.has(key)) throw new Error(`Duplicate exact key: ${key}`);
    exactKeys.add(key);
  }
  const formCounts = countBy(rows, "form");
  const roleCounts = countBy(rows, "role");
  if (!sameCounts(formCounts, manifest.formCounts)) throw new Error(`Form counts differ from manifest: ${JSON.stringify({ actual: formCounts, expected: manifest.formCounts })}`);
  if (!sameCounts(roleCounts, manifest.roleCounts)) throw new Error(`Role counts differ from manifest: ${JSON.stringify({ actual: roleCounts, expected: manifest.roleCounts })}`);

  const beforeDocuments = await db.select().from(documents).orderBy(asc(documents.id));
  const beforeFilings = await db.select().from(filings).orderBy(asc(filings.id));
  const existingByKey = new Map(beforeDocuments.map((row) => [keyOf(row), row]));
  const existingFilingKeys = new Set(beforeFilings.map((row) => `${row.cik}|${row.accessionNo}`));
  const overlap = rows.filter((row) => existingByKey.has(keyOf(row)));
  const outside = beforeDocuments.filter((row) => !exactKeys.has(keyOf(row)));
  const conflicts = overlap.filter((row) => {
    const existing = existingByKey.get(keyOf(row))!;
    return existing.sha256 && existing.sha256 !== row.sha256;
  }).map((row) => ({ key: keyOf(row), existingSha256: existingByKey.get(keyOf(row))!.sha256, candidateSha256: row.sha256 }));
  const conflictKeys = new Set(conflicts.map((row) => row.key));
  const rowsToApply = rows.filter((row) => !conflictKeys.has(keyOf(row)));
  const outsideFormCounts = countBy(outside as WorkerDocumentSnapshotRow[], "form");
  const outsideRoleCounts = countBy(outside as WorkerDocumentSnapshotRow[], "role");
  const expectedFormCounts = addCounts(formCounts, outsideFormCounts);
  const expectedRoleCounts = addCounts(roleCounts, outsideRoleCounts);
  for (const conflict of conflicts) {
    const candidateRole = rows.find((row) => keyOf(row) === conflict.key)!.role;
    const preservedRole = existingByKey.get(conflict.key)!.role;
    expectedRoleCounts[candidateRole] = (expectedRoleCounts[candidateRole] ?? 0) - 1;
    expectedRoleCounts[preservedRole] = (expectedRoleCounts[preservedRole] ?? 0) + 1;
  }
  const expectedDocumentsAfter = beforeDocuments.length + rows.length - overlap.length;
  const newFilingAccessions = new Set(rows.map((row) => `${row.cik}|${row.accessionNo}`));
  const expectedFilingsAfter = beforeFilings.length + [...newFilingAccessions].filter((key) => !existingFilingKeys.has(key)).length;
  const dryRun = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    status: conflicts.length ? "pass_with_preserved_conflicts" : "pass",
    conflictPolicy: "Preserve existing cloud rows completely when reviewed SHA256 differs; never overwrite their lineage",
    snapshot: { rows: rows.length, companies: manifest.companies, sha256: sha256(snapshotBytes), formCounts, roleCounts },
    before: { documents: beforeDocuments.length, filings: beforeFilings.length },
    overlap: overlap.length,
    existingOutsideSnapshot: outside.length,
    newDocuments: rows.length - overlap.length,
    expectedDocumentsAfter,
    expectedFilingsAfter,
    expectedFormCounts,
    expectedRoleCounts,
    hashConflicts: conflicts,
  };
  writeFileSync(path.join(outDir, "dry-run.json"), json(dryRun), { flag: "wx" });
  console.log(JSON.stringify({ outDir, ...dryRun }, null, 2));
  if (!apply) {
    await db.$client.end();
    process.exit(0);
  }

  const documentBackupText = `${JSON.stringify(beforeDocuments, null, 2)}\n`;
  const filingBackupText = `${JSON.stringify(beforeFilings, null, 2)}\n`;
  const backup = {
    generatedAt: new Date().toISOString(),
    beforeAnyDbWrite: true,
    documents: { rows: beforeDocuments.length, bytes: Buffer.byteLength(documentBackupText), sha256: sha256(documentBackupText) },
    filings: { rows: beforeFilings.length, bytes: Buffer.byteLength(filingBackupText), sha256: sha256(filingBackupText) },
  };
  writeFileSync(path.join(outDir, "backup-documents.json"), documentBackupText, { flag: "wx" });
  writeFileSync(path.join(outDir, "backup-filings.json"), filingBackupText, { flag: "wx" });
  writeFileSync(path.join(outDir, "backup-manifest.json"), json(backup), { flag: "wx" });

  const filingRows = [...new Map(rows.map((row) => [`${row.cik}|${row.accessionNo}`, {
    cik: row.cik,
    accessionNo: row.accessionNo,
    form: row.form,
    filingDate: row.filingDate,
    reportDate: row.reportDate ?? null,
    primaryDoc: row.primaryDoc,
  }])).values()];
  for (let start = 0; start < filingRows.length; start += BATCH_SIZE) {
    const batch = filingRows.slice(start, start + BATCH_SIZE);
    await db.insert(filings).values(batch).onDuplicateKeyUpdate({ set: { primaryDoc: sql`VALUES(\`primaryDoc\`)` } });
  }
  for (let start = 0; start < rowsToApply.length; start += BATCH_SIZE) {
    const batch = rowsToApply.slice(start, start + BATCH_SIZE);
    await db.transaction(async (tx) => {
      await tx.insert(documents).values(batch.map((row) => ({
        cik: row.cik,
        accessionNo: row.accessionNo,
        form: row.form,
        docName: row.docName,
        docType: row.docType,
        role: row.role,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        storageKey: null,
        textKey: null,
        textLength: row.textLength,
        parserVersion: row.parserVersion,
        location: "none",
        fetchStatus: "fetched",
        fetchedAt: row.fetchedAt ? new Date(row.fetchedAt) : new Date(),
        fetchError: null,
      }))).onDuplicateKeyUpdate({
        set: {
          docType: sql`VALUES(\`docType\`)`,
          role: sql`VALUES(\`role\`)`,
          sizeBytes: sql`VALUES(\`sizeBytes\`)`,
          sha256: sql`VALUES(\`sha256\`)`,
          textLength: sql`VALUES(\`textLength\`)`,
          parserVersion: sql`VALUES(\`parserVersion\`)`,
          storageKey: sql`COALESCE(\`storageKey\`, VALUES(\`storageKey\`))`,
          textKey: sql`COALESCE(\`textKey\`, VALUES(\`textKey\`))`,
          location: sql`COALESCE(\`location\`, VALUES(\`location\`))`,
          fetchStatus: "fetched",
          fetchedAt: sql`COALESCE(\`fetchedAt\`, VALUES(\`fetchedAt\`))`,
          fetchError: null,
        },
      });
    });
    if ((start / BATCH_SIZE + 1) % 10 === 0 || start + BATCH_SIZE >= rowsToApply.length) console.log(`[documents] ${Math.min(start + BATCH_SIZE, rowsToApply.length)}/${rowsToApply.length}`);
  }

  const afterDocuments = await db.select().from(documents).orderBy(asc(documents.id));
  const afterFilings = await db.select().from(filings).orderBy(asc(filings.id));
  const afterExactKeys = new Set<string>();
  for (const row of afterDocuments) {
    const key = keyOf(row);
    if (afterExactKeys.has(key)) throw new Error(`Duplicate exact key after apply: ${key}`);
    afterExactKeys.add(key);
  }
  const afterFormCounts = countBy(afterDocuments as WorkerDocumentSnapshotRow[], "form");
  const afterRoleCounts = countBy(afterDocuments as WorkerDocumentSnapshotRow[], "role");
  const originalStorageMismatches = beforeDocuments.filter((before) => {
    const after = afterDocuments.find((row) => row.id === before.id);
    return !after || after.storageKey !== before.storageKey || after.textKey !== before.textKey || after.location !== before.location;
  }).map((row) => row.id);
  const conflictRowsUnchanged = conflicts.every((conflict) => {
    const before = existingByKey.get(conflict.key)!;
    const after = afterDocuments.find((row) => row.id === before.id);
    return after && JSON.stringify(before) === JSON.stringify(after);
  });
  const errors: string[] = [];
  if (!conflictRowsUnchanged) errors.push("A hash-conflicted existing cloud row was modified");
  if (afterDocuments.length !== expectedDocumentsAfter) errors.push(`documents count ${afterDocuments.length} != ${expectedDocumentsAfter}`);
  if (afterFilings.length !== expectedFilingsAfter) errors.push(`filings count ${afterFilings.length} != ${expectedFilingsAfter}`);
  if (!sameCounts(afterFormCounts, expectedFormCounts)) errors.push("post-apply form counts mismatch");
  if (!sameCounts(afterRoleCounts, expectedRoleCounts)) errors.push("post-apply role counts mismatch");
  if (originalStorageMismatches.length) errors.push(`original storage metadata changed for ${originalStorageMismatches.length} rows`);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: errors.length ? "fail" : "pass",
    mode: "apply",
    backup,
    documentsBefore: beforeDocuments.length,
    documentsAfter: afterDocuments.length,
    filingsBefore: beforeFilings.length,
    filingsAfter: afterFilings.length,
    insertedDocuments: rows.length - overlap.length,
    updatedExistingDocuments: overlap.length - conflicts.length,
    preservedOutsideDocuments: outside.length,
    preservedHashConflicts: conflicts,
    conflictRowsUnchanged,
    remediatedFailedRows: beforeDocuments.filter((before) => before.fetchStatus === "failed" && afterDocuments.find((row) => row.id === before.id)?.fetchStatus === "fetched").map((row) => row.id),
    formCounts: afterFormCounts,
    roleCounts: afterRoleCounts,
    duplicateExactKeys: 0,
    originalStorageMismatches,
    errors,
  };
  writeFileSync(path.join(outDir, "apply-result.json"), json(result), { flag: "wx" });
  console.log(JSON.stringify({ outDir, ...result }, null, 2));
  if (errors.length) throw new Error("Documents post-check failed");
} finally {
  await db.$client.end();
}

function readFileSyncBytes(filePath: string): Buffer {
  return execFileSync("cat", [filePath], { maxBuffer: 64 * 1024 * 1024 });
}
