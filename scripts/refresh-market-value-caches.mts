import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { externalCache } from "@db/schema";
import { getDb } from "../api/queries/connection";
import { computeCompanyFactors } from "../api/services/factors";
import { computeCompanyValue } from "../api/services/valuation";
import { buildScreenerRows } from "../api/services/screener";
import { writeJsonAtomic } from "../worker/lib/json-file";

const apply = process.argv.includes("--apply");
const outputFile = "research/engine/market-value-cache-refresh.json";
const host = new URL(process.env.DATABASE_URL ?? "").hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
  throw new Error("Market-value cache refresh is restricted to loopback MySQL");
const universeBytes = readFileSync("worker/research-universe-50.json");
const universe = JSON.parse(universeBytes.toString("utf8")) as {
  cik: number;
  ticker: string;
}[];
const db = getDb();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function upsert(key: string, data: unknown) {
  const payload = JSON.stringify(data);
  await db
    .insert(externalCache)
    .values({ key, payload, source: "live" })
    .onDuplicateKeyUpdate({
      set: {
        payload: sql`VALUES(\`payload\`)`,
        fetchedAt: sql`VALUES(\`fetchedAt\`)`,
        source: sql`VALUES(\`source\`)`,
      },
    });
  const [stored] = await db
    .select()
    .from(externalCache)
    .where(eq(externalCache.key, key))
    .limit(1);
  const equal = Boolean(
    stored &&
    stored.source === "live" &&
    isDeepStrictEqual(JSON.parse(stored.payload), data)
  );
  return {
    key,
    bytes: Buffer.byteLength(payload),
    sha256: hash(payload),
    fetchedAt: stored?.fetchedAt ?? null,
    equal,
  };
}

try {
  const [memberships]: any = await db.execute(
    sql`SELECT DISTINCT userId FROM user_universe ORDER BY userId`
  );
  const [cached]: any = await db.execute(
    sql`SELECT \`key\` FROM external_cache WHERE \`key\` LIKE 'screener:u%' ORDER BY \`key\``
  );
  const userIds = [
    ...new Set<number>([
      ...memberships.map((row: any) => Number(row.userId)),
      ...cached
        .map((row: any) => Number(String(row.key).slice("screener:u".length)))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0),
    ]),
  ].sort((a, b) => a - b);
  const companies: any[] = [];
  const screeners: any[] = [];
  const startedAt = new Date().toISOString();
  if (apply) {
    for (const [index, company] of universe.entries()) {
      const factors = await computeCompanyFactors(company.cik);
      const value = await computeCompanyValue(company.cik);
      const factorCheck = await upsert(`factors:${company.cik}`, factors);
      const valueCheck = await upsert(`value:${company.cik}`, value);
      companies.push({
        ...company,
        factors: factorCheck,
        value: valueCheck,
        pass: factorCheck.equal && valueCheck.equal,
      });
      console.log(
        `[cache ${index + 1}/${universe.length}] ${company.ticker}: factors=${factorCheck.equal} value=${valueCheck.equal}`
      );
    }
    for (const userId of userIds) {
      const rows = await buildScreenerRows(userId);
      const check = await upsert(`screener:u${userId}`, rows);
      screeners.push({
        userId,
        rows: rows.length,
        ...check,
        pass: check.equal,
      });
      console.log(
        `[screener] user=${userId} rows=${rows.length} equal=${check.equal}`
      );
    }
  }
  const pass =
    companies.length === universe.length &&
    companies.every(row => row.pass) &&
    screeners.length === userIds.length &&
    screeners.every(row => row.pass);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status: apply ? (pass ? "pass" : "failed") : "dry_run",
    mode: apply ? "apply" : "dry_run",
    universe: {
      companies: universe.length,
      sha256: hash(universeBytes.toString("utf8")),
    },
    userIds,
    counts: {
      companies: companies.length,
      cacheKeys: companies.length * 2 + screeners.length,
      screeners: screeners.length,
      equal:
        companies.filter(row => row.pass).length * 2 +
        screeners.filter(row => row.pass).length,
    },
    companies,
    screeners,
    productionWrite: false,
    databaseWrite: apply,
  };
  writeJsonAtomic(outputFile, result, true);
  console.log(
    JSON.stringify(
      { status: result.status, counts: result.counts, userIds, outputFile },
      null,
      2
    )
  );
  if (apply && !pass) process.exitCode = 1;
} finally {
  await db.$client.end();
}
