import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./api/queries/connection";

export type Ddl030Database = ReturnType<typeof getDb>;
export interface Ddl030Backup {
  table: string;
  rowsTotal: number;
  tableFingerprint: string;
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const EXPECTED_STATEMENT = "ALTER TABLE cusip_map MODIFY COLUMN ticker TEXT NULL";

export function ddl030Statement(ddl: string): string {
  const statement = ddl.replace(/--[^\n]*\n/g, "").trim().replace(/;\s*$/, "");
  if (statement !== EXPECTED_STATEMENT) throw new Error("Unsupported DDL statement");
  return statement;
}

async function schemaState(db: Ddl030Database) {
  const [columns]: any = await db.execute(sql`SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cusip_map' AND COLUMN_NAME='ticker'`);
  const [counts]: any = await db.execute(sql`SELECT COUNT(*) AS rowsTotal FROM cusip_map`);
  const [createRows]: any = await db.execute(sql`SHOW CREATE TABLE cusip_map`);
  return {
    dataType: String(columns[0]?.DATA_TYPE ?? "").toLowerCase(),
    rowsTotal: Number(counts[0]?.rowsTotal ?? -1),
    tableFingerprint: sha256(String(createRows[0]?.["Create Table"] ?? "")),
  };
}

export async function applyDdl030(db: Ddl030Database, ddl: string, backup: Ddl030Backup, log: (message: string) => void = console.log): Promise<void> {
  const statement = ddl030Statement(ddl);
  if (backup.table !== "cusip_map") throw new Error("Unexpected backup table");
  const current = await schemaState(db);
  if (current.rowsTotal !== backup.rowsTotal) throw new Error("Backup row-count mismatch");
  const isText = ["text", "mediumtext", "longtext"].includes(current.dataType);
  if (!isText && current.tableFingerprint !== backup.tableFingerprint) throw new Error("Backup table fingerprint mismatch");
  if (isText) {
    log("step 1/1: ticker already uses TEXT; skipping");
    return;
  }
  await db.execute(sql.raw(statement));
  log("step 1/1: applied");
}

async function main(): Promise<void> {
  const argument = process.argv.indexOf("--backup-manifest");
  if (argument < 0 || !process.argv[argument + 1]) throw new Error("--backup-manifest is required");
  const manifestPath = path.resolve(process.argv[argument + 1]);
  if (!manifestPath.startsWith(`${path.resolve("worker/.runs")}${path.sep}`)) throw new Error("Backup manifest must stay under worker/.runs");
  const backup = JSON.parse(readFileSync(manifestPath, "utf8")) as Ddl030Backup & { backupFile: string; byteSize: number; sha256: string };
  const payload = readFileSync(path.join(path.dirname(manifestPath), backup.backupFile));
  if (payload.length !== backup.byteSize || sha256(payload) !== backup.sha256) throw new Error("Backup integrity mismatch");
  const db = getDb();
  try {
    const ddl = readFileSync(new URL("./db/ddl/030_cusip_map_ticker_text.sql", import.meta.url), "utf8");
    await applyDdl030(db, ddl, backup);
    const current = await schemaState(db);
    if (!["text", "mediumtext", "longtext"].includes(current.dataType)) throw new Error("Post-migration type verification failed");
    const post = { schemaVersion: 1, table: "cusip_map", rowsTotal: current.rowsTotal, tickerType: current.dataType, tableFingerprint: current.tableFingerprint, backupSha256: backup.sha256, productionApply: false };
    const postPath = path.join(path.dirname(manifestPath), "post-manifest.json");
    writeFileSync(postPath, `${JSON.stringify(post, null, 2)}\n`);
    console.log(JSON.stringify({ status: "complete", ...post, postManifest: postPath }, null, 2));
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("apply-ddl-030.mts")) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error && ["Unsupported DDL statement", "Backup row-count mismatch", "Backup table fingerprint mismatch", "Backup integrity mismatch"].includes(error.message) ? error.message : "Migration 030 failed");
    process.exitCode = 1;
  }
}
