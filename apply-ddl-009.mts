/**
 * One-shot applier for db/ddl/009_per_user_universe.sql. Idempotent:
 * information_schema / IF NOT EXISTS guards — safe to re-run.
 * No DROP / no --force. Run: npx tsx apply-ddl-009.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

// 1. user_universe
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`user_universe\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`userId\` bigint unsigned NOT NULL,
  \`cik\` int NOT NULL,
  \`ticker\` varchar(20) NOT NULL,
  \`name\` varchar(255) NULL,
  \`active\` tinyint(1) NOT NULL DEFAULT 1,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_user_universe_user_cik\` (\`userId\`, \`cik\`),
  KEY \`idx_user_universe_user_active\` (\`userId\`, \`active\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("user_universe: created (or already present)");

// 2. messages
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`messages\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`threadUserId\` bigint unsigned NOT NULL,
  \`authorId\` bigint unsigned NOT NULL,
  \`isAdminMsg\` tinyint(1) NOT NULL,
  \`body\` text NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`readAt\` timestamp NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_messages_thread\` (\`threadUserId\`, \`id\`),
  KEY \`idx_messages_readAt\` (\`readAt\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("messages: created (or already present)");

// 3. jobs.type enum += universe-add (append-only MODIFY, guarded)
const t: any = await db.execute(
  sql`SELECT COLUMN_TYPE ct FROM information_schema.columns WHERE table_name='jobs' AND column_name='type' AND table_schema = DATABASE()`
);
const ct: string = t[0][0]?.ct ?? "";
if (!ct.includes("universe-add")) {
  await db.execute(
    sql.raw(
      "ALTER TABLE `jobs` MODIFY COLUMN `type` enum('bootstrap','filings','stream','facts','harvest','series','sections','score','prices','universe-remove','universe-restore','universe-add') NOT NULL"
    )
  );
  console.log("jobs.type: enum extended (universe-add)");
} else {
  console.log("jobs.type: already extended");
}

// 4. Seed existing users' universes from the legacy global inUniverse flag.
//    (INSERT IGNORE: TiDB rejects ON DUPLICATE KEY UPDATE on INSERT…SELECT)
const seed: any = await db.execute(sql.raw(
  "INSERT IGNORE INTO `user_universe` (`userId`, `cik`, `ticker`, `name`, `active`) " +
  "SELECT u.id, c.cik, c.ticker, c.name, c.inUniverse FROM `users` u CROSS JOIN `companies` c"
));
console.log("seed: affected rows =", seed[0]?.affectedRows ?? "?");

const chk: any = await db.execute(sql`SELECT userId, COUNT(*) n, SUM(active) act FROM user_universe GROUP BY userId`);
for (const r of chk[0] as any[]) console.log(`  user ${r.userId}: ${r.n} memberships (${r.act} active)`);
process.exit(0);
