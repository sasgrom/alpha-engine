import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { institutionalSummary, sectorFlowsDetailed } from "../api/services/institutional";
import { evaluateCompany } from "../api/services/probability-engine";
import { dashboardStaticStatsOnRequest, DASHBOARD_STATS_PARENTS, INSTITUTIONAL_PARENTS, MARKET_REPORT_PARENTS, PAGE_DATA_KEYS, PROBABILITY_PARENTS, SECTOR_FLOWS_PARENTS } from "../api/services/page-data";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { writePageDataArtifact, type PageDataParents } from "../worker/lib/precomputed-page-data";
import { buildMarketReportGzip, pageDataCodeVersion } from "../worker/lib/market-report-gzip";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
};
const group = option("--group") ?? "all";
if (!["all", "stats", "institutional", "probability", "market"].includes(group)) throw new Error("--group must be all, stats, institutional, probability or market");
const universeFile = option("--universe") ?? "worker/research-universe-50.json";
const root = path.resolve(option("--root") ?? "worker/.runs/precomputed-page-data");
const summaryFile = option("--summary") ?? "research/engine/precomputed-page-data.summary.json";
const only = new Set((option("--only") ?? "").split(",").filter(Boolean).map((ticker) => ticker.toUpperCase()));
const universeBytes = readFileSync(universeFile);
const universe = JSON.parse(universeBytes.toString("utf8")) as { cik: number; ticker: string }[];
const selected = only.size ? universe.filter((company) => only.has(company.ticker.toUpperCase())) : universe;
if (selected.length !== only.size && only.size) throw new Error(`Universe is missing: ${[...only].filter((ticker) => !universe.some((company) => company.ticker.toUpperCase() === ticker)).join(",")}`);
if (!selected.length) throw new Error("No companies selected");
const codeVersion = pageDataCodeVersion();
const db = getDb();
const artifacts: any[] = [];
const failures: string[] = [];
const groups = group === "all" ? ["stats", "institutional", "market"] : [group];
let marketReport: unknown = null;

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const number = (value: unknown) => Number(value ?? 0);
const day = (value: unknown) => value === null || value === undefined ? null : String(value).slice(0, 19);

function writeSummary(status: string): void {
  writeJsonAtomic(summaryFile, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    codeVersion,
    groups,
    universe: { file: universeFile, requestedCompanies: selected.length, sha256: hash(universeBytes) },
    only: [...only],
    counts: {
      artifacts: artifacts.length,
      institutional: artifacts.filter((artifact) => artifact.key.startsWith("institutional-")).length,
      probability: artifacts.filter((artifact) => artifact.key.startsWith("probability-")).length,
    },
    artifacts,
    marketReport,
    failures,
    productionWrite: false,
    databaseWrite: false,
  }, true);
}

function save(key: string, parents: PageDataParents, payload: unknown, inputs: unknown, includeDay = true): void {
  const started = Date.now();
  const artifact = writePageDataArtifact({ key, parents, payload, inputs, includeDay, codeVersion, root });
  const file = path.join(root, `${key}.json`);
  const bytes = readFileSync(file);
  artifacts.push({ key, bytes: bytes.length, sha256: hash(bytes), generatedAt: artifact.generatedAt, inputsHash: artifact.inputsHash, versionHash: artifact.versionHash, inputs });
  writeSummary("running");
  console.log(JSON.stringify({ key, bytes: bytes.length, elapsedMs: Date.now() - started }));
}

async function companyInputs(cik: number) {
  const [rows]: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM factor_points WHERE cik=${cik}) factorPoints,
      (SELECT MAX(filedAt) FROM factor_points WHERE cik=${cik}) latestFactorFiledAt,
      (SELECT COUNT(*) FROM prices WHERE cik=${cik}) priceBars,
      (SELECT MAX(date) FROM prices WHERE cik=${cik}) latestPriceDate,
      (SELECT COUNT(*) FROM fund_holdings WHERE heldCik=${cik}) companyHoldings,
      (SELECT MAX(quarterDate) FROM fund_holdings WHERE heldCik=${cik}) latestHoldingQuarter,
      (SELECT COUNT(*) FROM signals WHERE cik=${cik} AND source='edgar') toneSignals,
      (SELECT MAX(eventTs) FROM signals WHERE cik=${cik} AND source='edgar') latestToneEvent`);
  const row = rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.startsWith("latest") ? day(value) : number(value)]));
}

async function globalInputs() {
  const [rows]: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM macro_points) macroPoints,
      (SELECT MAX(date) FROM macro_points) latestMacroDate,
      (SELECT COUNT(*) FROM prices WHERE cik=0) spyBars,
      (SELECT MAX(date) FROM prices WHERE cik=0) latestSpyDate,
      (SELECT COUNT(*) FROM fund_holdings) fundHoldings,
      (SELECT MAX(quarterDate) FROM fund_holdings) latestFundQuarter`);
  const row = rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.startsWith("latest") ? day(value) : number(value)]));
}

async function buildStats() {
  const payload = await dashboardStaticStatsOnRequest();
  const [lineage]: any = await db.execute(sql`SELECT (SELECT MAX(id) FROM facts) factMaxId, (SELECT MAX(id) FROM filings) filingMaxId`);
  save(PAGE_DATA_KEYS.dashboardStats, DASHBOARD_STATS_PARENTS, payload, { ...payload, ...lineage[0] }, false);
}

async function buildInstitutional() {
  for (const company of selected) {
    const payload = await institutionalSummary(company.cik);
    const [shares]: any = await db.execute(sql`SELECT val, endDate, accn, filed FROM facts WHERE cik=${company.cik} AND concept='EntityCommonStockSharesOutstanding' ORDER BY endDate DESC LIMIT 1`);
    save(PAGE_DATA_KEYS.institutional(company.cik), INSTITUTIONAL_PARENTS, payload, {
      ...(await companyInputs(company.cik)),
      latestSharesOut: shares[0] ? { value: number(shares[0].val), endDate: day(shares[0].endDate), accessionNo: shares[0].accn, filed: day(shares[0].filed) } : null,
    });
  }
}

async function buildSectorFlows() {
  const payload = await sectorFlowsDetailed();
  save(PAGE_DATA_KEYS.sectorFlows, SECTOR_FLOWS_PARENTS, payload, { global: await globalInputs(), guard: payload.guard });
}

async function buildProbability() {
  const global = await globalInputs();
  for (const company of selected) {
    const payload = await evaluateCompany(company.cik);
    save(PAGE_DATA_KEYS.probability(company.cik), PROBABILITY_PARENTS, payload, { company: await companyInputs(company.cik), global });
  }
}

function buildMarketReport() {
  const result = buildMarketReportGzip({ sourceFile: path.resolve("public/reports/schwab-market-data.json"), root, codeVersion });
  save(PAGE_DATA_KEYS.marketReport, MARKET_REPORT_PARENTS, result.payload, result.payload, false);
  marketReport = { ...result.payload, gzipBytes: result.gzipBytes };
  writeSummary("running");
}

writeSummary("running");
try {
  if (groups.includes("stats")) {
    await buildStats();
    await buildInstitutional();
  }
  if (groups.includes("institutional")) {
    await buildSectorFlows();
    await buildInstitutional();
    await buildProbability();
  }
  if (groups.includes("probability")) await buildProbability();
  if (groups.includes("market")) buildMarketReport();
  writeSummary("complete");
  console.log(JSON.stringify({ status: "complete", groups, companies: selected.length, artifacts: artifacts.length, summaryFile, root }, null, 2));
} catch (error) {
  failures.push(String(error).slice(0, 500));
  writeSummary("failed");
  throw error;
} finally {
  await db.$client.end();
}
