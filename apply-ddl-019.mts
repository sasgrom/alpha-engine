/**
 * One-shot applier for db/ddl/019_signals_note_uq_payloadkey.sql. Idempotent:
 * the note column is added only if absent (information_schema check); the
 * unique index is rebuilt only if it still lacks payloadKey.
 * Run: npx tsx apply-ddl-019.mts   (targets whatever DATABASE_URL points to —
 * local first, prod after review — the platform rule for schema changes)
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

// 1. note column
const [cols]: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'note'`
);
if (Number(cols[0].n) === 0) {
  await db.execute(sql.raw("ALTER TABLE `signals` ADD COLUMN `note` varchar(512) NULL"));
  console.log("signals.note: added");
} else console.log("signals.note: present, skipped");

// 2. uq_signals → include payloadKey
const [idx]: any = await db.execute(
  sql`SELECT COUNT(DISTINCT COLUMN_NAME) n, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signals' AND INDEX_NAME = 'uq_signals'`
);
const colsNow = String(idx[0]?.cols ?? "");
if (colsNow === "cik,source,signalType,eventTs") {
  await db.execute(sql.raw("ALTER TABLE `signals` DROP INDEX `uq_signals`"));
  await db.execute(sql.raw("ALTER TABLE `signals` ADD UNIQUE KEY `uq_signals` (`cik`,`source`,`signalType`,`eventTs`,`payloadKey`)"));
  console.log("uq_signals: rebuilt with payloadKey");
} else if (colsNow === "cik,source,signalType,eventTs,payloadKey") {
  console.log("uq_signals: already includes payloadKey, skipped");
} else {
  console.log(`uq_signals: unexpected columns "${colsNow}" — NOT TOUCHED, inspect manually`);
}
process.exit(0);
