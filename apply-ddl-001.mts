/**
 * One-off applier for db/ddl/001_companies_classification.sql.
 * drizzle-kit push is unavailable (interactive TTY) — DDL is applied manually.
 * Idempotent: columns/indexes are checked via information_schema, existing
 * ones are skipped. NO DROP / --force.
 * Run: npx tsx -r dotenv/config apply-ddl-001.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

async function columnExists(name: string): Promise<boolean> {
  const r: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = ${name}`
  );
  return Number(r[0][0].n) > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const r: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND INDEX_NAME = ${name}`
  );
  return Number(r[0][0].n) > 0;
}

if (!(await columnExists("sector"))) {
  await db.execute(sql`ALTER TABLE companies ADD COLUMN sector varchar(100) NULL AFTER fiscalYearEnd`);
  console.log("added column: sector");
} else console.log("column sector: already exists");

if (!(await columnExists("industry"))) {
  await db.execute(sql`ALTER TABLE companies ADD COLUMN industry varchar(160) NULL AFTER sector`);
  console.log("added column: industry");
} else console.log("column industry: already exists");

if (!(await indexExists("idx_companies_sector"))) {
  await db.execute(sql`CREATE INDEX idx_companies_sector ON companies (sector)`);
  console.log("added index: idx_companies_sector");
} else console.log("index idx_companies_sector: already exists");

console.log("DDL 001 applied OK");
process.exit(0);
