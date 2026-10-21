/**
 * One-shot applier for db/ddl/006_external_cache.sql.
 * Idempotent: CREATE TABLE IF NOT EXISTS — safe to re-run. No DROP / no --force.
 * Run: npx tsx apply-ddl-006.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`external_cache\` (
  \`key\` varchar(64) NOT NULL,
  \`payload\` mediumtext NOT NULL,
  \`fetchedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`source\` varchar(24) NOT NULL,
  PRIMARY KEY (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));

const chk: any = await db.execute(sql`SHOW TABLES LIKE 'external_cache'`);
console.log("external_cache:", chk[0].length === 1 ? "OK" : "MISSING");
process.exit(0);
