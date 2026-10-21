/**
 * One-shot applier for db/ddl/016_017_si_macro.sql. Idempotent.
 * Run: npx tsx apply-ddl-016.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`short_interest\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`settlementDate\` date NOT NULL,
  \`sharesShort\` bigint NULL,
  \`shortRatio\` double NULL,
  \`shortPercentOfFloat\` double NULL,
  \`source\` varchar(24) NOT NULL,
  \`fetchedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_short_interest\` (\`cik\`, \`settlementDate\`, \`source\`),
  KEY \`idx_si_cik_date\` (\`cik\`, \`settlementDate\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("short_interest: created (or present)");
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`macro_points\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`seriesId\` varchar(32) NOT NULL,
  \`date\` date NOT NULL,
  \`value\` double NULL,
  \`realtimeStart\` date NULL,
  \`realtimeEnd\` date NULL,
  \`fetchedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_macro_points\` (\`seriesId\`, \`date\`, \`realtimeStart\`),
  KEY \`idx_macro_series_date\` (\`seriesId\`, \`date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("macro_points: created (or present)");
process.exit(0);
