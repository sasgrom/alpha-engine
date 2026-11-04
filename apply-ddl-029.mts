/** One-shot applier for db/ddl/029_reviewer_access.sql. Idempotent, local reviewed migration only. */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "./api/queries/connection";

const db = getDb();
const [rows]: any = await db.execute(sql`
  SELECT TABLE_NAME tableName FROM information_schema.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('reviewer_access','reviewer_tour_preferences')`);
const existing = new Set(rows.map((row: any) => String(row.tableName)));
if (existing.has("reviewer_access") && existing.has("reviewer_tour_preferences")) {
  console.log("reviewer access tables already present; no migration needed");
} else {
  const ddl = readFileSync(new URL("./db/ddl/029_reviewer_access.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(ddl));
  console.log("reviewer access tables created; NDA, first-IP binding and tour preferences are ready");
}
process.exit(0);
