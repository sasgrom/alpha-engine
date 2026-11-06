import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { env } from "../api/lib/env";
import { companies } from "@db/schema";
import { assertExactRemediationScope, assertOnlyExpectedTickerFieldsChanged, EXPECTED_TICKER_REMEDIATION } from "../worker/lib/preferred-ticker-remediation";

const apply = process.argv.includes("--apply");
const ciks = EXPECTED_TICKER_REMEDIATION.map((row) => row.cik);
const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const universeCiks = universe.map((row) => row.cik);
const relatedTables = ["user_universe", "facts", "series_points", "prices"] as const;
const outDir = path.resolve(`worker/.runs/preferred-ticker-remediation/${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
const db = getDb();
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function databaseTarget() {
  const url = new URL(env.databaseUrl);
  return {
    connectionClass: ["127.0.0.1", "localhost", "::1"].includes(url.hostname) ? "loopback" : "non-loopback",
    documentedProduction: url.pathname.includes("1a141806-8802-84e1-8000-0966f924ee29"),
  };
}

async function mismatches(executor: any) {
  const rows = await executor.select({ cik: companies.cik, ticker: companies.ticker }).from(companies).where(inArray(companies.cik, universeCiks));
  const byCik = new Map(rows.map((row: any) => [Number(row.cik), String(row.ticker)]));
  return universe.filter((row) => byCik.get(row.cik) !== row.ticker).map((row) => ({ cik: row.cik, ticker: byCik.get(row.cik) ?? "<missing>" }));
}

async function relatedCounts(executor: any) {
  const result: Record<string, number> = {};
  for (const table of relatedTables) {
    const [rows]: any = await executor.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE cik IN (${sql.join(ciks.map((cik) => sql`${cik}`), sql`, `)})`);
    result[table] = Number(rows[0].n);
  }
  return result;
}

async function companiesCount(executor: any) {
  const [rows]: any = await executor.execute(sql`SELECT COUNT(*) AS n FROM companies`);
  return Number(rows[0].n);
}

function assertRelatedCountsEqual(before: Record<string, number>, after: Record<string, number>) {
  for (const table of relatedTables) {
    if (before[table] !== after[table]) throw new Error(`${table} count changed: ${before[table]} -> ${after[table]}`);
  }
}

try {
  const target = databaseTarget();
  const beforeMismatches = await mismatches(db);
  assertExactRemediationScope(beforeMismatches);
  const countBefore = await companiesCount(db);
  const relatedBefore = await relatedCounts(db);
  const dryRun = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    target,
    productionApply: false,
    diff: EXPECTED_TICKER_REMEDIATION.map((row) => ({ cik: row.cik, before: row.before, after: row.after })),
    companiesCountBefore: countBefore,
    relatedCounts: relatedBefore,
    mismatches: beforeMismatches,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "dry-run.json"), `${JSON.stringify(dryRun, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, ...dryRun }, null, 2));
  if (!apply) process.exit(0);
  if (!target.documentedProduction) throw new Error("Refusing apply without the documented production DATABASE_URL; the dry-run is not a production backup");

  const beforeRows = await db.select().from(companies).orderBy(asc(companies.cik));
  const backupBytes = Buffer.from(`${JSON.stringify(beforeRows, null, 2)}\n`, "utf8");
  const backupPath = path.join(outDir, "production-companies-backup.json");
  writeFileSync(backupPath, backupBytes);
  const backup = { path: backupPath, rows: beforeRows.length, bytes: backupBytes.length, sha256: sha256(backupBytes) };

  const applied = await db.transaction(async (tx) => {
    assertExactRemediationScope(await mismatches(tx));
    for (const row of EXPECTED_TICKER_REMEDIATION) {
      const [result]: any = await tx.execute(sql`UPDATE companies SET ticker = ${row.after} WHERE cik = ${row.cik} AND ticker = ${row.before}`);
      if (Number(result.affectedRows) !== 1) throw new Error(`Expected-before guard failed for CIK ${row.cik}; transaction rolled back`);
    }
    const afterRows = await tx.select().from(companies).orderBy(asc(companies.cik)).for("update");
    const updatedIds = assertOnlyExpectedTickerFieldsChanged(beforeRows, afterRows);
    const countAfter = await companiesCount(tx);
    if (countAfter !== countBefore) throw new Error(`Companies count changed: ${countBefore} -> ${countAfter}`);
    const relatedAfter = await relatedCounts(tx);
    assertRelatedCountsEqual(relatedBefore, relatedAfter);
    const afterMismatches = await mismatches(tx);
    if (afterMismatches.length) throw new Error(`Universe mismatches remain: ${JSON.stringify(afterMismatches)}`);
    return { updatedIds, companiesCountAfter: countAfter, relatedCountsAfter: relatedAfter, mismatches: afterMismatches };
  });

  const afterRows = await db.select().from(companies).orderBy(asc(companies.cik));
  const updatedIds = assertOnlyExpectedTickerFieldsChanged(beforeRows, afterRows);
  const countAfter = await companiesCount(db);
  const relatedAfter = await relatedCounts(db);
  assertRelatedCountsEqual(relatedBefore, relatedAfter);
  const afterMismatches = await mismatches(db);
  if (afterMismatches.length) throw new Error(`Post-check mismatches: ${JSON.stringify(afterMismatches)}`);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "apply",
    target,
    backup,
    updatedIds,
    companiesCountBefore: countBefore,
    companiesCountAfter: countAfter,
    relatedCountsBefore: relatedBefore,
    relatedCountsAfter: relatedAfter,
    mismatches: afterMismatches,
    transaction: applied,
  };
  writeFileSync(path.join(outDir, "apply-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, ...result }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await getDb().$client.end();
}
