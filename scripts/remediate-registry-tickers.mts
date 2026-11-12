/**
 * Brings the LOCAL company registry in line with the GICS snapshot (api/services/canonical-ticker.ts): the ticker
 * of an index member is its traded common share, never another security of the same filer, and a missing sector
 * or industry is filled. Watchlist rows (user_universe) of the corrected companies get the same ticker.
 *
 *   npx tsx scripts/remediate-registry-tickers.mts            dry run: prints and saves the planned corrections
 *   npx tsx scripts/remediate-registry-tickers.mts --apply    loopback MySQL only: backup, one transaction, post-check
 *
 * Nothing is deleted and no row is added. Every UPDATE is guarded by the value expected before it; a guard that
 * does not match rolls the whole transaction back. Production is out of reach by construction (loopback only) and
 * needs its own reviewed run by the owner.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { env } from "../api/lib/env";
import { registryCorrections, type RegistryCorrection, type RegistryRow } from "../api/services/canonical-ticker";

const apply = process.argv.includes("--apply");
const outDir = path.resolve(`worker/.runs/registry-ticker-remediation/${new Date().toISOString().replace(/[:.]/g, "")}`);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const host = new URL(env.databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("This remediation runs against loopback MySQL only");

const client = getDb().$client.promise();
const rowsOf = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query(sql, params))[0] as T[];

async function plan() {
  const companies = await rowsOf<RegistryRow & { name: string | null }>("SELECT cik, ticker, name, sector, industry FROM companies ORDER BY cik");
  // the ticker each company's latest Stooq closes were fetched under: the traded common share
  const fetched = await rowsOf<{ cik: number; ticker: string; latest: string }>(
    "SELECT cik, ticker, DATE_FORMAT(MAX(date), '%Y-%m-%d') AS latest FROM prices WHERE source = 'stooq' AND cik > 0 AND date >= DATE_SUB(CURDATE(), INTERVAL 120 DAY) GROUP BY cik, ticker",
  );
  const traded = new Map<number, string>();
  const latest = new Map<number, string>();
  for (const row of fetched) {
    if ((latest.get(Number(row.cik)) ?? "") < row.latest) {
      latest.set(Number(row.cik), row.latest);
      traded.set(Number(row.cik), row.ticker);
    }
  }
  const corrections = registryCorrections(companies.map((row) => ({ ...row, cik: Number(row.cik) })), traded);
  const tickerFix = new Map(corrections.filter((entry) => entry.field === "ticker").map((entry) => [entry.cik, entry]));
  // two registry rows must never end up with one ticker
  const finalTicker = new Map(companies.map((row) => [Number(row.cik), tickerFix.get(Number(row.cik))?.after ?? row.ticker]));
  for (const [cik, ticker] of finalTicker) {
    if (tickerFix.has(cik) && [...finalTicker].some(([other, value]) => other !== cik && value === ticker)) throw new Error(`Ticker ${ticker} would be held by two registry rows (CIK ${cik}); nothing changed`);
  }
  const watchlist = tickerFix.size
    ? await rowsOf<{ id: number; userId: number; cik: number; ticker: string }>("SELECT id, userId, cik, ticker FROM user_universe WHERE cik IN (?) ORDER BY id", [[...tickerFix.keys()]])
    : [];
  const watchlistCorrections = watchlist
    .filter((row) => row.ticker !== tickerFix.get(Number(row.cik))!.after)
    .map((row) => ({ id: Number(row.id), userId: Number(row.userId), cik: Number(row.cik), before: row.ticker, after: tickerFix.get(Number(row.cik))!.after }));
  const names = new Map(companies.map((row) => [Number(row.cik), row.name]));
  return { companies, corrections, watchlistCorrections, names };
}

function summarize(corrections: RegistryCorrection[]) {
  return {
    tickers: corrections.filter((entry) => entry.field === "ticker").length,
    sectors: corrections.filter((entry) => entry.field === "sector").length,
    industries: corrections.filter((entry) => entry.field === "industry").length,
  };
}

const before = await plan();
mkdirSync(outDir, { recursive: true });
const dryRun = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: apply ? "local-apply-plan" : "local-dry-run",
  target: { host, productionApply: false },
  companies: before.companies.length,
  summary: summarize(before.corrections),
  corrections: before.corrections.map((entry) => ({ ...entry, name: before.names.get(entry.cik) ?? null })),
  watchlistCorrections: before.watchlistCorrections,
};
writeFileSync(path.join(outDir, "dry-run.json"), `${JSON.stringify(dryRun, null, 1)}\n`);
console.log(`[registry] ${before.companies.length} companies · planned: ${dryRun.summary.tickers} tickers, ${dryRun.summary.sectors} sectors, ${dryRun.summary.industries} industries, ${before.watchlistCorrections.length} watchlist rows · ${path.join(outDir, "dry-run.json")}`);
for (const entry of before.corrections.filter((row) => row.field === "ticker")) console.log(`  ${String(entry.cik).padStart(8)}  ${String(entry.before).padEnd(9)} -> ${entry.after.padEnd(6)} ${before.names.get(entry.cik) ?? ""}`);

if (!apply || (before.corrections.length === 0 && before.watchlistCorrections.length === 0)) {
  if (apply) console.log("[registry] nothing to change");
  process.exit(0);
}

const backupBody = `${JSON.stringify({ companies: await rowsOf("SELECT * FROM companies ORDER BY cik"), userUniverse: await rowsOf("SELECT * FROM user_universe ORDER BY id") }, null, 1)}\n`;
writeFileSync(path.join(outDir, "backup.json"), backupBody);
const backup = { file: path.join(outDir, "backup.json"), bytes: Buffer.byteLength(backupBody), sha256: sha256(backupBody) };

const connection = await client.getConnection();
try {
  await connection.beginTransaction();
  for (const entry of before.corrections) {
    const [result]: any = await connection.query(`UPDATE companies SET \`${entry.field}\` = ? WHERE cik = ? AND \`${entry.field}\` <=> ?`, [entry.after, entry.cik, entry.before]);
    if (Number(result.affectedRows) !== 1) throw new Error(`Expected-before guard failed for CIK ${entry.cik} ${entry.field}; rolled back`);
  }
  for (const entry of before.watchlistCorrections) {
    const [result]: any = await connection.query("UPDATE user_universe SET ticker = ? WHERE id = ? AND cik = ? AND ticker = ?", [entry.after, entry.id, entry.cik, entry.before]);
    if (Number(result.affectedRows) !== 1) throw new Error(`Expected-before guard failed for watchlist row ${entry.id}; rolled back`);
  }
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}

// post-check: nothing left to correct, the same rows as before, and no field changed outside the plan
const after = await plan();
if (after.corrections.length || after.watchlistCorrections.length) throw new Error(`Post-check: ${after.corrections.length} registry and ${after.watchlistCorrections.length} watchlist corrections remain`);
if (after.companies.length !== before.companies.length) throw new Error("Post-check: the number of companies changed");
const planned = new Set(before.corrections.map((entry) => `${entry.cik}|${entry.field}`));
const beforeByCik = new Map(before.companies.map((row) => [Number(row.cik), row]));
const unexpected: string[] = [];
for (const row of after.companies) {
  const was = beforeByCik.get(Number(row.cik));
  if (!was) { unexpected.push(`new row ${row.cik}`); continue; }
  for (const field of ["ticker", "name", "sector", "industry"] as const) {
    if (was[field] !== row[field] && !planned.has(`${Number(row.cik)}|${field}`)) unexpected.push(`${row.cik}.${field}`);
  }
}
if (unexpected.length) throw new Error(`Post-check: fields changed outside the plan: ${unexpected.slice(0, 10).join(", ")}`);
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), mode: "local-apply", target: { host, productionApply: false }, backup, applied: summarize(before.corrections), watchlistRows: before.watchlistCorrections.length, remaining: 0 };
writeFileSync(path.join(outDir, "apply-result.json"), `${JSON.stringify(result, null, 1)}\n`);
console.log(`[registry] applied: ${result.applied.tickers} tickers, ${result.applied.sectors} sectors, ${result.applied.industries} industries, ${result.watchlistRows} watchlist rows · post-check clean · backup ${backup.bytes} bytes sha256 ${backup.sha256.slice(0, 16)}… · ${outDir}`);
process.exit(0);
