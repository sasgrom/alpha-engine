/** One-shot applier for db/ddl/028_signals_note_2000.sql. Idempotent.
 * Run: npx tsx apply-ddl-028.mts (LOCAL first, prod only after backup/restore). */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const [rows]: any = await db.execute(sql`
  SELECT DATA_TYPE dataType, CHARACTER_MAXIMUM_LENGTH maxLength
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signals' AND COLUMN_NAME='note'`);
const column = rows[0];
if (!column) throw new Error("signals.note is missing; apply DDL 019 first");
const dataType = String(column.dataType).toLowerCase();
const maxLength = Number(column.maxLength ?? 0);
if ((dataType === "varchar" && maxLength >= 2000) || ["text", "mediumtext", "longtext"].includes(dataType)) {
  console.log(`signals.note: ${dataType}${maxLength ? `(${maxLength})` : ""}, no change needed`);
} else {
  const ddl = readFileSync(new URL("./db/ddl/028_signals_note_2000.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(ddl));
  console.log(`signals.note: widened from ${dataType}(${maxLength}) to varchar(2000); existing notes preserved`);
}
process.exit(0);
