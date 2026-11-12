import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { institutionalSummary, sectorFlowsDetailed } from "../api/services/institutional";
import { evaluateCompany } from "../api/services/probability-engine";
import { dashboardStaticStatsOnRequest, DASHBOARD_STATS_PARENTS, INSTITUTIONAL_PARENTS, PAGE_DATA_KEYS, PROBABILITY_PARENTS, SECTOR_FLOWS_PARENTS } from "../api/services/page-data";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { readPageDataArtifact, type PageDataParents } from "../worker/lib/precomputed-page-data";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const universeFile = option("--universe") ?? "worker/research-universe-50.json";
const root = path.resolve(option("--root") ?? "worker/.runs/precomputed-page-data");
const outputFile = option("--output") ?? "research/engine/precomputed-page-data.equality.json";
const only = new Set((option("--only") ?? "").split(",").filter(Boolean).map((ticker) => ticker.toUpperCase()));
const universe = JSON.parse(readFileSync(universeFile, "utf8")) as { cik: number; ticker: string }[];
const required = ["AAPL", "NVDA", "JPM", "PLD", "NEE"];
const companies = only.size ? universe.filter((company) => only.has(company.ticker.toUpperCase())) : [
  ...universe.filter((company) => required.includes(company.ticker)),
  ...universe.filter((company) => !required.includes(company.ticker)).slice(0, 5),
];
if (companies.length !== (only.size || 10) || required.some((ticker) => !only.size && !companies.some((company) => company.ticker === ticker))) {
  throw new Error("The equality scope must contain ten universe companies, including AAPL, NVDA, JPM, PLD and NEE");
}

function compareValues(before: unknown, after: unknown, path = "$"): { compared: number; differences: { path: string; before: unknown; after: unknown }[] } {
  if (typeof before === "number" && typeof after === "number" && Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) <= 1e-12) return { compared: 1, differences: [] };
  if (Object.is(before, after)) return { compared: 1, differences: [] };
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    const result = { compared: 0, differences: [] as { path: string; before: unknown; after: unknown }[] };
    for (let index = 0; index < before.length; index++) {
      const nested = compareValues(before[index], after[index], `${path}[${index}]`);
      result.compared += nested.compared;
      result.differences.push(...nested.differences);
    }
    return result;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const result = { compared: 0, differences: [] as { path: string; before: unknown; after: unknown }[] };
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const nested = compareValues((before as any)[key], (after as any)[key], `${path}.${key}`);
      result.compared += nested.compared;
      result.differences.push(...nested.differences);
    }
    return result;
  }
  return { compared: 1, differences: [{ path, before, after }] };
}

const checks: any[] = [];
const db = getDb();
async function verify(key: string, parents: PageDataParents, compute: () => Promise<unknown>, includeDay = true) {
  const cached = readPageDataArtifact({ key, parents, root, includeDay });
  if (!cached) {
    checks.push({ key, pass: false, error: "missing_or_invalid_artifact" });
    return;
  }
  const started = Date.now();
  const onRequest = await compute();
  const comparison = compareValues(onRequest, cached.payload);
  const file = path.join(root, `${key}.json`);
  const bytes = readFileSync(file);
  checks.push({
    key,
    pass: comparison.differences.length === 0,
    codeVersion: cached.codeVersion,
    generatedAt: cached.generatedAt,
    stale: cached.stale,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    onRequestMs: Date.now() - started,
    compared: comparison.compared,
    differences: comparison.differences.slice(0, 30),
    differenceCount: comparison.differences.length,
  });
  console.log(JSON.stringify({ key, pass: comparison.differences.length === 0, compared: comparison.compared, differenceCount: comparison.differences.length, onRequestMs: Date.now() - started }));
}

try {
  await verify(PAGE_DATA_KEYS.dashboardStats, DASHBOARD_STATS_PARENTS, dashboardStaticStatsOnRequest, false);
  await verify(PAGE_DATA_KEYS.sectorFlows, SECTOR_FLOWS_PARENTS, sectorFlowsDetailed);
  for (const company of companies) {
    await verify(PAGE_DATA_KEYS.institutional(company.cik), INSTITUTIONAL_PARENTS, () => institutionalSummary(company.cik));
    await verify(PAGE_DATA_KEYS.probability(company.cik), PROBABILITY_PARENTS, () => evaluateCompany(company.cik));
  }
  const pass = checks.length === companies.length * 2 + 2 && checks.every((check) => check.pass);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: pass ? "pass" : "failed",
    tolerance: 1e-12,
    companies: companies.map((company) => ({ cik: company.cik, ticker: company.ticker })),
    requiredCompaniesPresent: required.every((ticker) => companies.some((company) => company.ticker === ticker)),
    factorIc: "unchanged_on_request",
    checks,
    pass,
    productionWrite: false,
    databaseWrite: false,
  };
  writeJsonAtomic(outputFile, result, true);
  console.log(JSON.stringify({ status: result.status, companies: companies.length, checks: checks.length, outputFile }, null, 2));
  if (!pass) process.exitCode = 1;
} catch (error) {
  writeJsonAtomic(outputFile, { schemaVersion: 1, generatedAt: new Date().toISOString(), status: "failed", error: String(error).slice(0, 500), checks, productionWrite: false, databaseWrite: false }, true);
  throw error;
} finally {
  await db.$client.end();
}
