/**
 * One-shot applier for db/ddl/013_signals_014_insider_trades.sql. Idempotent.
 * Run: npx tsx apply-ddl-013.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`signals\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`source\` varchar(24) NOT NULL,
  \`signalType\` varchar(24) NOT NULL,
  \`eventTs\` datetime NOT NULL,
  \`ingestedAt\` datetime NOT NULL,
  \`score\` double NULL,
  \`magnitude\` double NULL,
  \`payloadKey\` varchar(255) NULL,
  \`src\` varchar(24) NOT NULL DEFAULT 'live',
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_signals\` (\`cik\`, \`source\`, \`signalType\`, \`eventTs\`),
  KEY \`idx_signals_cik_ingested\` (\`cik\`, \`ingestedAt\`),
  KEY \`idx_signals_eventts\` (\`eventTs\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("signals: created (or present)");
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`insider_trades\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`accessionNo\` varchar(25) NOT NULL,
  \`insiderName\` varchar(255) NULL,
  \`insiderRole\` varchar(64) NULL,
  \`code\` varchar(2) NOT NULL,
  \`shares\` double NULL,
  \`price\` double NULL,
  \`sharesAfter\` double NULL,
  \`tradeDate\` date NULL,
  \`filingDate\` date NOT NULL,
  \`is10b5\` tinyint(1) NOT NULL DEFAULT 0,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_insider_trades\` (\`cik\`, \`accessionNo\`, \`code\`, \`shares\`),
  KEY \`idx_insider_cik_date\` (\`cik\`, \`tradeDate\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("insider_trades: created (or present)");
process.exit(0);
