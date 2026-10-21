/**
 * One-shot applier for db/ddl/007_events.sql. Idempotent: IF NOT EXISTS /
 * information_schema checks — safe to re-run. No DROP / no --force.
 * Run: npx tsx apply-ddl-007.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

// 1. filings.items (information_schema guard — TiDB has no ADD COLUMN IF NOT EXISTS on some versions)
const col: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.columns WHERE table_name='filings' AND column_name='items' AND table_schema = DATABASE()`
);
if (Number(col[0][0].n) === 0) {
  await db.execute(sql.raw("ALTER TABLE `filings` ADD COLUMN `items` varchar(200) NULL AFTER `primaryDoc`"));
  console.log("filings.items: added");
} else {
  console.log("filings.items: already present");
}

// 2. events table
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`events\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`type\` varchar(24) NOT NULL,
  \`eventDate\` date NOT NULL,
  \`filingDate\` date NULL,
  \`accessionNo\` varchar(25) NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_events\` (\`cik\`, \`type\`, \`accessionNo\`),
  KEY \`idx_events_cik_date\` (\`cik\`, \`eventDate\`),
  KEY \`idx_events_date\` (\`eventDate\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));

const chk: any = await db.execute(sql`SHOW TABLES LIKE 'events'`);
console.log("events:", chk[0].length === 1 ? "OK" : "MISSING");
process.exit(0);
