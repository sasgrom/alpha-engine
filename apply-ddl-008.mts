/**
 * One-shot applier for db/ddl/008_universe_removal.sql. Idempotent:
 * information_schema checks — safe to re-run. No DROP / no --force.
 * Run: npx tsx apply-ddl-008.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

// 1. companies.removedAt / removedBy (information_schema guard — TiDB has no
//    ADD COLUMN IF NOT EXISTS on some versions)
for (const col of ["removedAt", "removedBy"] as const) {
  const chk: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.columns WHERE table_name='companies' AND column_name=${col} AND table_schema = DATABASE()`
  );
  if (Number(chk[0][0].n) === 0) {
    const ddl =
      col === "removedAt"
        ? "ALTER TABLE `companies` ADD COLUMN `removedAt` timestamp NULL AFTER `inUniverse`"
        : "ALTER TABLE `companies` ADD COLUMN `removedBy` bigint unsigned NULL AFTER `removedAt`";
    await db.execute(sql.raw(ddl));
    console.log(`companies.${col}: added`);
  } else {
    console.log(`companies.${col}: already present`);
  }
}

// 2. jobs.type enum += universe-remove / universe-restore (append-only MODIFY;
//    guarded by the current COLUMN_TYPE so re-runs are no-ops)
const t: any = await db.execute(
  sql`SELECT COLUMN_TYPE ct FROM information_schema.columns WHERE table_name='jobs' AND column_name='type' AND table_schema = DATABASE()`
);
const ct: string = t[0][0]?.ct ?? "";
if (!ct.includes("universe-remove")) {
  await db.execute(
    sql.raw(
      "ALTER TABLE `jobs` MODIFY COLUMN `type` enum('bootstrap','filings','stream','facts','harvest','series','sections','score','prices','universe-remove','universe-restore') NOT NULL"
    )
  );
  console.log("jobs.type: enum extended");
} else {
  console.log("jobs.type: already extended");
}

process.exit(0);
