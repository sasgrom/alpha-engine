/** One-shot applier for db/ddl/026_fund_jobs.sql. Idempotent.
 *  Run: npx tsx apply-ddl-026.mts  (local first, prod after review) */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const ddl = readFileSync(new URL("./db/ddl/026_fund_jobs.sql", import.meta.url), "utf8");
await getDb().execute(sql.raw(ddl));
console.log("fund_jobs: created (or present)");
process.exit(0);
