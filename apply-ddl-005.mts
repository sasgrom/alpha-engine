/**
 * One-shot applier for db/ddl/005_prices.sql.
 * Idempotent: the CREATE TABLE uses IF NOT EXISTS; the enum extension is
 * skipped when 'prices' is already a member (information_schema check) —
 * safe to re-run. No DROP / no --force.
 * Run: npx tsx apply-ddl-005.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

// 1. prices table -----------------------------------------------------------
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`prices\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`ticker\` varchar(20) NOT NULL,
  \`date\` date NOT NULL,
  \`open\` double NULL,
  \`high\` double NULL,
  \`low\` double NULL,
  \`close\` double NULL,
  \`adjClose\` double NULL,
  \`volume\` bigint NULL,
  \`source\` varchar(16) NOT NULL,
  \`fetchedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_prices_bar\` (\`cik\`, \`date\`, \`source\`),
  KEY \`idx_prices_cik_date\` (\`cik\`, \`date\`),
  KEY \`idx_prices_ticker\` (\`ticker\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("prices table ensured");

// 2. jobs.type enum += 'prices' ---------------------------------------------
const col: any = await db.execute(
  sql`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'type'`
);
const colType = String(col[0][0]?.t ?? "");
if (colType.includes("'prices'")) {
  console.log("jobs.type already contains 'prices' — skipped");
} else {
  await db.execute(sql.raw(`ALTER TABLE \`jobs\` MODIFY COLUMN \`type\`
    ENUM('bootstrap','filings','stream','facts','harvest','series','sections','score','prices') NOT NULL`));
  console.log("jobs.type extended with 'prices'");
}

// verify
const t: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prices'`
);
const c: any = await db.execute(
  sql`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'type'`
);
const ok = Number(t[0][0].n) === 1 && String(c[0][0].t).includes("'prices'");
console.log(ok ? "DDL 005 applied OK" : "DDL 005 FAILED");
process.exit(ok ? 0 : 1);
