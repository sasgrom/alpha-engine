/**
 * One-shot applier for db/ddl/015_worker_keys.sql. Idempotent.
 * Run: npx tsx apply-ddl-015.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`worker_keys\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`keyHash\` varchar(64) NOT NULL,
  \`label\` varchar(64) NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`lastUsedAt\` timestamp NULL,
  \`revokedAt\` timestamp NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_worker_keys_hash\` (\`keyHash\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("worker_keys: created (or present)");
process.exit(0);
