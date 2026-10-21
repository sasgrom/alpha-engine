/**
 * One-off applier for db/ddl/003_sentiment_scores.sql.
 * Idempotent: the jobs.type enum extension is safe to repeat (MODIFY to the
 * same set), the table is created IF NOT EXISTS. No DROP / --force.
 * Run: npx tsx -r dotenv/config apply-ddl-003.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

await db.execute(sql.raw(
  "ALTER TABLE `jobs` MODIFY COLUMN `type` enum('bootstrap','filings','stream','facts','harvest','series','sections','score') NOT NULL"
));
console.log("jobs.type enum extended");

await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`sentiment_scores\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`cik\` int NOT NULL,
  \`accessionNo\` varchar(25) NOT NULL,
  \`form\` varchar(12) NOT NULL,
  \`documentId\` bigint unsigned NOT NULL,
  \`sectionId\` bigint unsigned,
  \`sectionKey\` varchar(48) NOT NULL,
  \`aspect\` varchar(24) NOT NULL,
  \`score\` double NOT NULL,
  \`confidence\` double NOT NULL,
  \`evidence\` text,
  \`evidenceOk\` boolean NOT NULL,
  \`pairwise\` boolean NOT NULL DEFAULT false,
  \`llmVersion\` varchar(120) NOT NULL,
  \`promptVersion\` varchar(24) NOT NULL,
  \`usageTokens\` int,
  \`scoredAt\` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_score_idem\` (\`documentId\`, \`sectionKey\`, \`aspect\`, \`llmVersion\`, \`promptVersion\`),
  KEY \`idx_scores_cik_aspect\` (\`cik\`, \`aspect\`),
  KEY \`idx_scores_accn\` (\`accessionNo\`)
)`));

const r: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_scores'`
);
console.log(Number(r[0][0].n) === 1 ? "DDL 003 applied OK (sentiment_scores)" : "DDL 003 FAILED");
process.exit(0);
