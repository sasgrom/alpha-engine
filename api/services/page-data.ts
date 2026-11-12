import { and, count, eq, max } from "drizzle-orm";
import { companies, facts, filings, jobs, userUniverse } from "@db/schema";
import { getDb } from "../queries/connection";
import { servePageData, type PageDataResult } from "../../worker/lib/precomputed-page-data";
import { institutionalSummary, sectorFlowsDetailed } from "./institutional";
import { evaluateCompany } from "./probability-engine";

export const DASHBOARD_STATS_PARENTS = ["facts-fetch-daily", "sp500-facts-daily", "edgar-fetch-daily"] as const;
export const INSTITUTIONAL_PARENTS = ["13f-refresh", "facts-fetch-daily", "sp500-facts-daily"] as const;
export const SECTOR_FLOWS_PARENTS = ["13f-refresh"] as const;
export const PROBABILITY_PARENTS = ["research-factors", "schwab-daily-bars", "13f-refresh", "macro-fred-weekly", "edgar-tone-nightly"] as const;
export const MARKET_REPORT_PARENTS = ["schwab-snapshot"] as const;

export const PAGE_DATA_KEYS = {
  dashboardStats: "dashboard-stats",
  sectorFlows: "sector-flows",
  marketReport: "market-report-gzip",
  institutional: (cik: number) => `institutional-${cik}`,
  probability: (cik: number) => `probability-${cik}`,
};

export interface PageDataMetadata {
  asOf: string | null;
  stale: boolean;
  dataMode: "precomputed" | "on_request";
}

export async function dashboardStaticStatsOnRequest() {
  const db = getDb();
  const [companyCount] = await db.select({ n: count() }).from(companies);
  const [filingCount] = await db.select({ n: count() }).from(filings);
  const [factCount] = await db.select({ n: count() }).from(facts);
  const [latest] = await db.select({ d: max(filings.filingDate) }).from(filings);
  return { companies: companyCount.n, filings: filingCount.n, facts: factCount.n, latestFilingDate: latest.d };
}

export async function dashboardStats(userId: number) {
  const db = getDb();
  const [staticStats, universe, running, queued] = await Promise.all([
    servePageData({ key: PAGE_DATA_KEYS.dashboardStats, parents: DASHBOARD_STATS_PARENTS, includeDay: false, compute: dashboardStaticStatsOnRequest }),
    db.select({ n: count() }).from(userUniverse).where(and(eq(userUniverse.userId, userId), eq(userUniverse.active, true))).then((rows) => rows[0]),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "running")).then((rows) => rows[0]),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "queued")).then((rows) => rows[0]),
  ]);
  return {
    ...staticStats.payload,
    universe: universe.n,
    runningJobs: running.n,
    queuedJobs: queued.n,
    asOf: staticStats.asOf,
    stale: staticStats.stale,
    dataMode: staticStats.dataMode,
  };
}

function withMetadata<T extends object>(result: PageDataResult<T>): T & PageDataMetadata {
  return { ...result.payload, asOf: result.asOf, stale: result.stale, dataMode: result.dataMode };
}

export async function institutionalPageData(cik: number) {
  return withMetadata(await servePageData({
    key: PAGE_DATA_KEYS.institutional(cik),
    parents: INSTITUTIONAL_PARENTS,
    compute: () => institutionalSummary(cik),
  }));
}

export async function sectorFlowsPageData() {
  return withMetadata(await servePageData({
    key: PAGE_DATA_KEYS.sectorFlows,
    parents: SECTOR_FLOWS_PARENTS,
    compute: sectorFlowsDetailed,
  }));
}

export async function probabilityPageData(cik: number) {
  const result = await servePageData({
    key: PAGE_DATA_KEYS.probability(cik),
    parents: PROBABILITY_PARENTS,
    compute: () => evaluateCompany(cik),
  });
  return result.payload === null ? null : withMetadata({ ...result, payload: result.payload });
}
