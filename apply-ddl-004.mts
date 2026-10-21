/**
 * One-shot applier for db/ddl/004_jobs_startedby.sql.
 * Idempotent: the ADD COLUMN is skipped when the column already exists
 * (information_schema check) — safe to re-run. No DROP / no --force.
 * Run: npx tsx apply-ddl-004.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

const existing: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'startedBy'`
);
if (Number(existing[0][0].n) === 0) {
  await db.execute(sql.raw("ALTER TABLE `jobs` ADD COLUMN `startedBy` bigint unsigned NULL"));
  console.log("jobs.startedBy added");
} else {
  console.log("jobs.startedBy already present — skipped");
}

const check: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'startedBy'`
);
console.log(Number(check[0][0].n) === 1 ? "DDL 004 applied OK" : "DDL 004 FAILED");
process.exit(0);
