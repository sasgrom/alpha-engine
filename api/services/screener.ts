/**
 * Screener (iteration 4a, D28) — the universe-wide metrics table that turns
 * accumulated data into the daily working surface.
 *
 * Every column is computed IN-HOUSE from our own tables (D22 honesty):
 *   price / change% / 52-week position / beta   — prices table (vs SPY, cik=0)
 *   market cap / P/E TTM / EPS TTM              — canonical series (Stage 1.6)
 *   FCF margin TTM                              — (CFO − capex) / revenue, TTM
 *   revision rate                               — company_data_health (Stage 1.6)
 *   sentiment                                   — latest (llmVersion, prompt)
 *                                                 pair average (Stage 2.2 prototype)
 *
 * Owner principle (D27): the table is built once per user and served from
 * the DB cache (external_cache, 20 h TTL, stale-while-revalidate, key
 * `screener:u<userId>` — per-user since 4c/D30) — nobody waits for a
 * rebuild. A rebuild over N companies costs N×(bars+series) reads; fine at
 * test-universe size, becomes the nightly job's work at S&P scale (TODO at
 * that point: SQL-aggregate precompute instead of per-company loops).
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, companyDataHealth, userUniverse } from "@db/schema";
import { avgVolume, beta5y, changePct, fundamentalsFromSeries, getBars, week52 } from "./prices";
import { cachedExternal } from "./ext-cache";

export interface ScreenerRow {
  cik: number;
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  peTtm: number | null;
  epsTtm: number | null;
  fcfMarginTtm: number | null;
  beta: number | null;
  /** position inside the 52-week range, 0..1 (0 = at the low) */
  week52Pos: number | null;
  avgVolume3m: number | null;
  /** share of quarterly points revised between vintages (data-quality factor) */
  revisionRate: number | null;
  /** latest-pair mean aspect score, −1..+1 (null = never scored) */
  sentiment: number | null;
  priceAsOf: string | null;
}

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------
/** Sum of the latest 4 quarterly points (desc-sorted input); null if < 4. */
export function ttm4(points: { periodEnd: string; val: number | null }[]): number | null {
  const vals = points.filter((p) => p.val !== null).slice(0, 4);
  return vals.length === 4 ? vals.reduce((s, p) => s + (p.val as number), 0) : null;
}

/** (CFO − capex) / revenue on TTM sums; capex stored positive here. */
export function fcfMargin(cfoTtm: number | null, capexTtm: number | null, revTtm: number | null): number | null {
  if (cfoTtm === null || capexTtm === null || revTtm === null || revTtm === 0) return null;
  return (cfoTtm - capexTtm) / revTtm;
}

/** Position of price inside [low, high], 0..1; null on degenerate input. */
export function week52Pos(price: number | null, high: number | null, low: number | null): number | null {
  if (price === null || high === null || low === null || high <= low) return null;
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------
const CONC_REV = "RevenueFromContractWithCustomerExcludingAssessedTax";
const CONC_CFO = "NetCashProvidedByUsedInOperatingActivities";
const CONC_CAPEX = "PaymentsToAcquirePropertyPlantAndEquipment";

/**
 * Build the screener rows for ONE user's universe (4c, D30): their active
 * memberships. Companies not yet ingested (auto-ingest queued) appear with
 * null metrics — an honest placeholder, not a missing row.
 */
export async function buildScreenerRows(userId: number): Promise<ScreenerRow[]> {
  const db = getDb();
  const universe = await db
    .select({
      cik: userUniverse.cik,
      ticker: userUniverse.ticker,
      name: sql<string | null>`COALESCE(${companies.name}, ${userUniverse.name})`,
      sector: companies.sector,
      inDb: sql<boolean>`${companies.cik} IS NOT NULL`,
    })
    .from(userUniverse)
    .leftJoin(companies, eq(userUniverse.cik, companies.cik))
    .where(and(eq(userUniverse.userId, userId), eq(userUniverse.active, true)))
    .limit(2000);

  const from5y = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
  const spy = await getBars(0, from5y);

  // latest sentiment version-pair per company, averaged over its rows.
  // 4h review fix: "latest" by MAX(id) (insertion order = chronology) — the
  // pre-4h lexicographic CONCAT(llmVersion, promptVersion) breaks silently
  // once a version string hits double digits ("v10" < "v2").
  const sentRows: any = await db.execute(sql`
    SELECT cik, llmVersion, promptVersion, AVG(score) avgScore, MAX(id) maxId
    FROM sentiment_scores
    GROUP BY cik, llmVersion, promptVersion`);
  const latestSent = new Map<number, number>();
  {
    const byCik = new Map<number, { maxId: number; avg: number }>();
    for (const r of sentRows[0] ?? []) {
      const cur = byCik.get(Number(r.cik));
      if (!cur || Number(r.maxId) > cur.maxId) byCik.set(Number(r.cik), { maxId: Number(r.maxId), avg: Number(r.avgScore) });
    }
    for (const [cik, v] of byCik) latestSent.set(cik, v.avg);
  }

  const health = await db.select().from(companyDataHealth);
  const healthByCik = new Map(health.map((h) => [h.cik, h]));

  const rows: ScreenerRow[] = [];
  for (const c of universe) {
    if (!c.inDb) {
      // auto-ingest is queued — the company has no shared data yet
      rows.push({
        cik: c.cik, ticker: c.ticker, name: c.name ?? c.ticker, sector: c.sector,
        price: null, changePct: null, marketCap: null, peTtm: null, epsTtm: null,
        fcfMarginTtm: null, beta: null, week52Pos: null, avgVolume3m: null,
        revisionRate: null, sentiment: null, priceAsOf: null,
      });
      continue;
    }
    const bars = await getBars(c.cik, from5y);
    const last = bars.length ? bars[bars.length - 1] : null;
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    const lastClose = last ? (last.adjClose ?? last.close) : null;
    const prevClose = prev ? (prev.adjClose ?? prev.close) : null;
    const w52 = week52(bars);

    const { epsTtm, sharesDiluted } = await fundamentalsFromSeries(c.cik);

    // TTM flows for the FCF margin (revenue/CFO/capex, latest vintage)
    const flows: any = await db.execute(sql`
      SELECT concept, periodEnd, val FROM series_points
      WHERE cik=${c.cik} AND vintage='latest' AND kind='flow'
        AND concept IN (${CONC_REV}, ${CONC_CFO}, ${CONC_CAPEX})
      ORDER BY concept, periodEnd DESC`);
    const byConcept = new Map<string, { periodEnd: string; val: number | null }[]>();
    for (const r of flows[0] ?? []) {
      const arr = byConcept.get(r.concept) ?? [];
      arr.push({ periodEnd: String(r.periodEnd).slice(0, 10), val: r.val === null ? null : Number(r.val) });
      byConcept.set(r.concept, arr);
    }
    const revTtm = ttm4(byConcept.get(CONC_REV) ?? []);
    const cfoTtm = ttm4(byConcept.get(CONC_CFO) ?? []);
    const capexTtm = ttm4(byConcept.get(CONC_CAPEX) ?? []);

    rows.push({
      cik: c.cik,
      ticker: c.ticker,
      name: c.name ?? c.ticker,
      sector: c.sector,
      price: lastClose,
      changePct: lastClose !== null && prevClose !== null ? changePct(lastClose, prevClose) : null,
      marketCap: lastClose !== null && sharesDiluted !== null ? lastClose * sharesDiluted : null,
      peTtm: lastClose !== null && epsTtm !== null && epsTtm !== 0 ? lastClose / epsTtm : null,
      epsTtm,
      fcfMarginTtm: fcfMargin(cfoTtm, capexTtm, revTtm),
      beta: spy.length > 0 ? beta5y(bars, spy) : null,
      week52Pos: week52Pos(lastClose, w52.high, w52.low),
      avgVolume3m: avgVolume(bars, 92),
      revisionRate: healthByCik.get(c.cik)?.avgRevisionRate ?? null,
      sentiment: latestSent.get(c.cik) ?? null,
      priceAsOf: last?.date ?? null,
    });
  }
  return rows;
}

/**
 * Cached read (D27): 20 h TTL, stale-while-revalidate, ONE KEY PER USER
 * (4c, D30 — `screener:u<userId>`). Membership mutations delete the key
 * (invalidateScreenerCache) so the next read recomputes instead of serving
 * a stale universe.
 */
export async function getScreener(userId: number): Promise<{ rows: ScreenerRow[]; asOf: string; fresh: boolean }> {
  const r = await cachedExternal(`screener:u${userId}`, 20 * 3600_000, async () => buildScreenerRows(userId));
  return { rows: r.data, asOf: r.asOf, fresh: r.fresh };
}
