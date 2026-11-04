/** One-shot applier for db/ddl/029_reviewer_access.sql. Idempotent, local reviewed migration only. */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "./api/queries/connection";

export type Ddl029Database = ReturnType<typeof getDb>;

export function splitDdl029Statements(ddl: string): string[] {
  return ddl
    .split(";")
    .map((part) => part.replace(/--[^\n]*\n/g, "").trim())
    .filter(Boolean);
}

function indexTarget(statement: string): { tableName: string; indexName: string } {
  const match = statement.match(/^CREATE\s+INDEX\s+(`[^`]+`|\w+)\s+ON\s+(`[^`]+`|\w+)(?=\s|$)/i);
  if (!match) throw new Error("Unsupported DDL statement");
  const tableName = match[2].replaceAll("`", "");
  const indexName = match[1].replaceAll("`", "");
  if (tableName !== "reviewer_access" || indexName !== "idx_reviewer_access_accepted") throw new Error("Unexpected index target");
  return { tableName, indexName };
}

export async function reviewerAcceptedIndexExists(db: Ddl029Database, tableName: string, indexName: string): Promise<boolean> {
  const [rows]: any = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${tableName} AND INDEX_NAME=${indexName}`);
  return Number(rows[0]?.count ?? 0) > 0;
}

export async function applyDdl029(db: Ddl029Database, ddl: string, log: (message: string) => void = console.log): Promise<void> {
  const statements = splitDdl029Statements(ddl);
  for (const [index, statement] of statements.entries()) {
    const step = index + 1;
    if (/^CREATE\s+INDEX\b/i.test(statement)) {
      const target = indexTarget(statement);
      if (await reviewerAcceptedIndexExists(db, target.tableName, target.indexName)) {
        log(`step ${step}/${statements.length}: idx_reviewer_access_accepted already exists; skipping`);
        continue;
      }
    } else if (!/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(statement)) {
      throw new Error("Unsupported DDL statement");
    }
    await db.execute(sql.raw(statement));
    log(`step ${step}/${statements.length}: applied`);
  }
}

async function main(): Promise<void> {
  const db = getDb();
  try {
    const ddl = readFileSync(new URL("./db/ddl/029_reviewer_access.sql", import.meta.url), "utf8");
    await applyDdl029(db, ddl);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("apply-ddl-029.mts")) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error && error.message === "Unsupported DDL statement" ? error.message : "Migration 029 failed");
    process.exitCode = 1;
  }
}
