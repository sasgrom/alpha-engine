/** Read-only per-CIK lineage and coverage reconciliation for the current DB. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { orphanCiks, reconcilePipeline, type PipelineCounts } from "../api/services/reconciliation";

const db = getDb();
async function counts(table: string): Promise<Map<number, number>> {
  const [rows]: any = await db.execute(sql.raw(`SELECT cik, COUNT(*) n FROM ${table} GROUP BY cik`));
  return new Map(rows.map((r: any) => [Number(r.cik), Number(r.n)]));
}
const expected = loadEdgarUniverse("research-universe-53.json").map((c) => c.cik);
const [facts, series, factors, prices, companyRows]: [Map<number, number>, Map<number, number>, Map<number, number>, Map<number, number>, any] = await Promise.all([
  counts("facts"), counts("series_points"), counts("factor_points"), counts("prices"),
  db.execute(sql`SELECT cik, ticker FROM companies`),
]);
const registered = new Set(companyRows[0].map((r: any) => Number(r.cik)));
const tickers = new Map(companyRows[0].map((r: any) => [Number(r.cik), String(r.ticker)]));
const ciks = [...new Set([...expected, ...facts.keys(), ...series.keys(), ...factors.keys()])].sort((a, b) => a - b);
const rows: (PipelineCounts & { ticker: string | null })[] = ciks.map((cik) => ({
  cik, ticker: tickers.get(cik) ?? null,
  facts: facts.get(cik) ?? 0, series: series.get(cik) ?? 0, factors: factors.get(cik) ?? 0,
  prices: prices.get(cik) ?? 0, registered: registered.has(cik),
}));
const issues = reconcilePipeline(rows);
const expectedOrphans = orphanCiks(expected, ciks);
const out = {
  generatedAt: new Date().toISOString(), source: "current DB connection; read-only",
  expectedCiks: expected.length, expectedOrphans,
  summary: {
    companies: rows.length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    facts: rows.reduce((s, r) => s + r.facts, 0),
    series: rows.reduce((s, r) => s + r.series, 0),
    factors: rows.reduce((s, r) => s + r.factors, 0),
    prices: rows.reduce((s, r) => s + r.prices, 0),
  },
  issues,
  rows,
};
console.log(JSON.stringify(out, null, 2));
if (process.argv.includes("--strict") && (expectedOrphans.length || issues.some((i) => i.severity === "error"))) process.exit(1);
process.exit(0);
