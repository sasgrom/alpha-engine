/**
 * One-off applier for db/ddl/002_document_sections.sql.
 * Idempotent (CREATE TABLE IF NOT EXISTS). No DROP / --force.
 * Run: npx tsx -r dotenv/config apply-ddl-002.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";

const db = getDb();
const ddl = readFileSync(new URL("./db/ddl/002_document_sections.sql", import.meta.url), "utf-8");
// the file holds a single statement; strip the comment header for a clean log
const stmt = ddl.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
await db.execute(sql.raw(stmt));

const r: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_sections'`
);
console.log(Number(r[0][0].n) === 1 ? "DDL 002 applied OK (document_sections)" : "DDL 002 FAILED");
process.exit(0);
