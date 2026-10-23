/**
 * One-shot applier for db/ddl/020_digests.sql. Idempotent (IF NOT EXISTS).
 * Run: npx tsx apply-ddl-020.mts  (local first, prod after review)
 */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const ddl = readFileSync(new URL("./db/ddl/020_digests.sql", import.meta.url), "utf8");
await getDb().execute(sql.raw(ddl));
console.log("digests: created (or present)");
process.exit(0);
