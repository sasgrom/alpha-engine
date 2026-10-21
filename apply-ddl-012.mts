/**
 * One-shot applier for db/ddl/012_derived_ytd.sql. Idempotent (guarded by the
 * current COLUMN_TYPE). Run: npx tsx apply-ddl-012.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const t: any = await db.execute(
  sql`SELECT COLUMN_TYPE ct FROM information_schema.columns WHERE table_name='series_points' AND column_name='derivation' AND table_schema = DATABASE()`
);
const ct: string = t[0][0]?.ct ?? "";
if (!ct.includes("derived_ytd")) {
  await db.execute(
    sql.raw("ALTER TABLE `series_points` MODIFY COLUMN `derivation` enum('reported','derived_q4','derived_ytd') NOT NULL")
  );
  console.log("series_points.derivation: enum extended");
} else {
  console.log("series_points.derivation: already extended");
}
process.exit(0);
