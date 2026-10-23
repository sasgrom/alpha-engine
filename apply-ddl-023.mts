/**
 * One-shot applier for db/ddl/023_fund_holdings_class_figi_meta.sql. Idempotent.
 * Run: npx tsx apply-ddl-023.mts  (local first, prod after review)
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
async function hasColumn(table: string, col: string): Promise<boolean> {
  const [r]: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${col}`
  );
  return Number(r[0].n) > 0;
}
if (!(await hasColumn("fund_holdings", "secClass"))) {
  await db.execute(sql.raw("ALTER TABLE `fund_holdings` ADD COLUMN `secClass` varchar(12) NOT NULL DEFAULT 'COM' AFTER `cusip`"));
  await db.execute(sql.raw("ALTER TABLE `fund_holdings` DROP INDEX `uq_fund_holding`"));
  await db.execute(sql.raw("ALTER TABLE `fund_holdings` ADD UNIQUE KEY `uq_fund_holding` (`fundCik`,`cusip`,`secClass`,`quarterDate`)"));
  console.log("fund_holdings.secClass: added, uq rebuilt");
} else console.log("fund_holdings.secClass: present, skipped");

if (!(await hasColumn("cusip_map", "exchCode"))) {
  await db.execute(sql.raw("ALTER TABLE `cusip_map` ADD COLUMN `exchCode` varchar(16) NULL"));
  await db.execute(sql.raw("ALTER TABLE `cusip_map` ADD COLUMN `secType` varchar(48) NULL"));
  console.log("cusip_map exchCode/secType: added");
} else console.log("cusip_map meta: present, skipped");
process.exit(0);
