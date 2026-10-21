/**
 * One-shot applier for db/ddl/011_contacts_activity.sql. Idempotent.
 * Run: npx tsx apply-ddl-011.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

async function addColumn(table: string, col: string, ddl: string) {
  const chk: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.columns WHERE table_name=${table} AND column_name=${col} AND table_schema = DATABASE()`
  );
  if (Number(chk[0][0].n) === 0) {
    await db.execute(sql.raw(ddl));
    console.log(`${table}.${col}: added`);
  } else {
    console.log(`${table}.${col}: already present`);
  }
}
async function addKey(table: string, key: string, ddl: string) {
  const chk: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.statistics WHERE table_name=${table} AND index_name=${key} AND table_schema = DATABASE()`
  );
  if (Number(chk[0][0].n) === 0) {
    await db.execute(sql.raw(ddl));
    console.log(`${table}.${key}: added`);
  } else {
    console.log(`${table}.${key}: already present`);
  }
}

await addColumn("messages", "convKey", "ALTER TABLE `messages` ADD COLUMN `convKey` varchar(32) NULL AFTER `threadUserId`");
await addColumn("messages", "recipientId", "ALTER TABLE `messages` ADD COLUMN `recipientId` bigint unsigned NULL AFTER `authorId`");
await addKey("messages", "idx_messages_conv", "ALTER TABLE `messages` ADD KEY `idx_messages_conv` (`convKey`, `id`)");
await addKey("messages", "idx_messages_recipient", "ALTER TABLE `messages` ADD KEY `idx_messages_recipient` (`recipientId`, `readAt`)");

await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`activity_events\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`userId\` bigint unsigned NOT NULL,
  \`type\` varchar(24) NOT NULL,
  \`path\` varchar(255) NULL,
  \`ip\` varchar(64) NULL,
  \`meta\` varchar(500) NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_activity_user\` (\`userId\`, \`id\`),
  KEY \`idx_activity_type_ts\` (\`type\`, \`createdAt\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`));
console.log("activity_events: created (or already present)");
process.exit(0);
