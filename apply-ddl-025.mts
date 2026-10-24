/** One-shot applier for db/ddl/025_factor_points.sql. Idempotent.
 *  Run: npx tsx apply-ddl-025.mts  (local first, prod after review) */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const ddl = readFileSync(new URL("./db/ddl/025_factor_points.sql", import.meta.url), "utf8");
await getDb().execute(sql.raw(ddl));
console.log("factor_points: created (or present)");
process.exit(0);
