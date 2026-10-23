/**
 * One-shot applier for db/ddl/021_digests_scope.sql. Idempotent (column check).
 * Run: npx tsx apply-ddl-021.mts  (local first, prod after review)
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const [cols]: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'digests' AND COLUMN_NAME = 'scope'`
);
if (Number(cols[0].n) === 0) {
  await db.execute(sql.raw("ALTER TABLE `digests` ADD COLUMN `scope` varchar(32) NOT NULL DEFAULT '' AFTER `kind`"));
  await db.execute(sql.raw("ALTER TABLE `digests` DROP INDEX `uq_digests`"));
  await db.execute(sql.raw("ALTER TABLE `digests` ADD UNIQUE KEY `uq_digests` (`kind`,`scope`,`forDate`)"));
  console.log("digests.scope: added, uq rebuilt");
} else console.log("digests.scope: present, skipped");
process.exit(0);
