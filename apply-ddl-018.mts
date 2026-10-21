/**
 * One-shot applier for db/ddl/018_metric_history.sql. Idempotent.
 * Run: npx tsx apply-ddl-018.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`metric_history\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`metric\` varchar(24) NOT NULL,
  \`date\` date NOT NULL,
  \`value\` double NULL,
  \`computedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_metric_history\` (\`cik\`, \`metric\`, \`date\`),
  KEY \`idx_metric_history\` (\`cik\`, \`metric\`, \`date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("metric_history: created (or present)");
process.exit(0);
