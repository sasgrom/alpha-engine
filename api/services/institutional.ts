/**
 * 13F institutional aggregates with read-side coverage safeguards.
 * Current-quarter levels and QoQ flows are deliberately different products:
 * levels use the selected quarter's book; flows use comparable funds only.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  buildGuardMeta,
  comparableFunds,
  selectQuarterPair,
  type ComparableFunds,
  type GuardMeta,
  type QuarterSelection,
} from "./institutional-guard";
import { flowMetrics } from "./flow-metrics";

interface GuardedQuarter {
  selection: QuarterSelection;
  comparable: ComparableFunds;
  meta: GuardMeta;
}

async function readGuard(db: ReturnType<typeof getDb>): Promise<GuardedQuarter | null> {
  const asOf = new Date().toISOString().slice(0, 10);
  const [quarters]: any = await db.execute(sql`
    SELECT quarterDate, COUNT(DISTINCT fundCik) funds
    FROM fund_holdings WHERE secClass='COM' GROUP BY quarterDate`);
  const selection = selectQuarterPair(
    quarters.map((q: any) => ({ quarterDate: String(q.quarterDate).slice(0, 10), funds: Number(q.funds) })),
    asOf
  );
  if (!selection) return null;
  let comparable: ComparableFunds = { stable: [], missing: [], suspect: [] };
  if (selection.prev) {
    const [counts]: any = await db.execute(sql`
      SELECT fundCik, quarterDate, COUNT(*) positions FROM fund_holdings
      WHERE quarterDate IN (${selection.cur}, ${selection.prev}) AND secClass='COM'
      GROUP BY fundCik, quarterDate`);
    comparable = comparableFunds(counts.map((r: any) => ({
      fundCik: Number(r.fundCik), quarterDate: String(r.quarterDate).slice(0, 10), positions: Number(r.positions),
    })), selection.cur, selection.prev);
  }
  return { selection, comparable, meta: buildGuardMeta(selection, comparable) };
}

export interface InstitutionalSummary {
  quarterDate: string | null;
  previousQuarterDate: string | null;
  holders: number;
  sharesHeld: number | null;
  valueUsd: number | null;
  qoqSharesDeltaPct: number | null;
  ownershipPct: number | null;
  guard: GuardMeta | null;
  top: { fundName: string; tier: string | null; shares: number | null; valueUsd: number | null }[];
}

export async function institutionalSummary(cik: number): Promise<InstitutionalSummary> {
  const db = getDb();
  const empty: InstitutionalSummary = {
    quarterDate: null, previousQuarterDate: null, holders: 0, sharesHeld: null,
    valueUsd: null, qoqSharesDeltaPct: null, ownershipPct: null, guard: null, top: [],
  };
  const guarded = await readGuard(db);
  if (!guarded) return empty;
  const { cur, prev } = guarded.selection;
  const stable = guarded.comparable.stable;

  const [agg]: any = await db.execute(sql`
    SELECT COUNT(DISTINCT fundCik) holders, SUM(shares) sharesHeld, SUM(valueUsd) valueUsd
    FROM fund_holdings WHERE heldCik=${cik} AND quarterDate=${cur} AND secClass='COM'`);
  const curShares = Number(agg[0]?.sharesHeld ?? 0) || null;
  const curValue = Number(agg[0]?.valueUsd ?? 0) || null;
  const holders = Number(agg[0]?.holders ?? 0);

  let qoqSharesDeltaPct: number | null = null;
  if (prev && stable.length >= 2) {
    const [rows]: any = await db.execute(sql`
      SELECT quarterDate, SUM(shares) shares FROM fund_holdings
      WHERE heldCik=${cik} AND quarterDate IN (${cur}, ${prev}) AND secClass='COM'
        AND fundCik IN (${sql.join(stable.map((id) => sql`${id}`), sql`, `)})
      GROUP BY quarterDate`);
    const byQuarter = new Map<string, number>(rows.map((r: any): [string, number] => [String(r.quarterDate).slice(0, 10), Number(r.shares ?? 0)]));
    const stableCur = byQuarter.get(cur) ?? 0, stablePrev = byQuarter.get(prev) ?? 0;
    if (stablePrev > 0) qoqSharesDeltaPct = Math.round(((stableCur - stablePrev) / stablePrev) * 1000) / 10;
  }

  let ownershipPct: number | null = null;
  const [sh]: any = await db.execute(sql`
    SELECT val FROM facts WHERE cik=${cik} AND concept='EntityCommonStockSharesOutstanding'
    ORDER BY endDate DESC LIMIT 1`);
  const sharesOut = Number(sh[0]?.val ?? 0);
  if (sharesOut > 0 && curShares !== null) ownershipPct = Math.round((curShares / sharesOut) * 1000) / 10;

  const top = (await db.execute(sql`
    SELECT fundName, tier, SUM(shares) shares, SUM(valueUsd) valueUsd
    FROM fund_holdings WHERE heldCik=${cik} AND quarterDate=${cur} AND secClass='COM'
    GROUP BY fundName, tier ORDER BY valueUsd DESC LIMIT 5`))[0] as unknown as any[];

  return {
    quarterDate: cur,
    previousQuarterDate: prev,
    holders,
    sharesHeld: curShares,
    valueUsd: curValue,
    qoqSharesDeltaPct,
    ownershipPct,
    guard: guarded.meta,
    top: top.map((t) => ({
      fundName: t.fundName,
      tier: t.tier,
      shares: t.shares !== null ? Number(t.shares) : null,
      valueUsd: t.valueUsd !== null ? Number(t.valueUsd) : null,
    })),
  };
}

export interface FundFlowsGraphResponse {
  funds: { cik: number; name: string; tier: string | null }[];
  companies: { cik: number; ticker: string; sector: string | null }[];
  edges: { fundCik: number; cik: number; curUsd: number; deltaUsd: number; curShares: number; deltaShares: number; deltaWeightPp: number | null }[];
  guard: GuardMeta | null;
}

export async function fundFlowsGraph(limit = 400): Promise<FundFlowsGraphResponse> {
  const db = getDb();
  const guarded = await readGuard(db);
  const [companies]: any = await db.execute(sql`SELECT cik, ticker, sector FROM companies`);
  const companyRows = companies.map((c: any) => ({ cik: Number(c.cik), ticker: String(c.ticker), sector: c.sector ?? null }));
  if (!guarded) return { funds: [], companies: companyRows, edges: [], guard: null };
  const { cur, prev } = guarded.selection;
  const stable = guarded.comparable.stable;
  if (!prev || stable.length < 2) return { funds: [], companies: companyRows, edges: [], guard: guarded.meta };

  const [rows]: any = await db.execute(sql`
    SELECT h.fundCik, h.heldCik AS cik,
           SUM(CASE WHEN h.quarterDate=${cur} THEN h.shares ELSE 0 END) curShares,
           SUM(CASE WHEN h.quarterDate=${prev} THEN h.shares ELSE 0 END) prevShares,
           SUM(CASE WHEN h.quarterDate=${cur} THEN h.valueUsd ELSE 0 END) curUsd,
           SUM(CASE WHEN h.quarterDate=${prev} THEN h.valueUsd ELSE 0 END) prevUsd,
           MAX(CASE WHEN q.quarterDate=${cur} THEN q.totalValueUsd END) curBook,
           MAX(CASE WHEN q.quarterDate=${prev} THEN q.totalValueUsd END) prevBook
    FROM fund_holdings h
    LEFT JOIN fund_quarters q ON q.fundCik=h.fundCik AND q.quarterDate=h.quarterDate
    WHERE h.quarterDate IN (${cur}, ${prev}) AND h.secClass='COM' AND h.heldCik IS NOT NULL
      AND h.fundCik IN (${sql.join(stable.map((id) => sql`${id}`), sql`, `)})
    GROUP BY h.fundCik, h.heldCik
    HAVING ABS(curShares - prevShares) > 0
    ORDER BY ABS(curShares - prevShares) DESC
    LIMIT ${limit}`);
  const fundCiks = [...new Set(rows.map((r: any) => Number(r.fundCik)))];
  const funds = fundCiks.length === 0 ? [] : ((await db.execute(sql`
    SELECT DISTINCT fundCik, fundName, tier FROM fund_holdings
    WHERE fundCik IN (${sql.join(fundCiks.map((c) => sql`${c}`), sql`, `)})`))[0] as unknown as any[])
    .map((f: any) => ({ cik: Number(f.fundCik), name: String(f.fundName), tier: f.tier ?? null }));
  return {
    funds,
    companies: companyRows,
    edges: rows.map((r: any) => {
      const curShares = Number(r.curShares ?? 0), prevShares = Number(r.prevShares ?? 0);
      const m = flowMetrics(curShares, prevShares, r.curBook === null ? null : Number(r.curBook), r.prevBook === null ? null : Number(r.prevBook));
      return {
        fundCik: Number(r.fundCik), cik: Number(r.cik), curUsd: Number(r.curUsd ?? 0),
        deltaUsd: Number(r.curUsd ?? 0) - Number(r.prevUsd ?? 0),
        curShares,
        deltaShares: m.deltaShares,
        deltaWeightPp: m.deltaWeightPp,
      };
    }),
    guard: guarded.meta,
  };
}

export interface SectorFlowRow { sector: string; deltaUsd: number; curUsd: number; deltaShares: number; curShares: number; deltaWeightPp: number | null }
export interface SectorFlowsDetailed { rows: SectorFlowRow[]; guard: GuardMeta | null }

export async function sectorFlowsDetailed(): Promise<SectorFlowsDetailed> {
  const db = getDb();
  const guarded = await readGuard(db);
  if (!guarded) return { rows: [], guard: null };
  const { cur, prev } = guarded.selection;
  const stable = guarded.comparable.stable;
  if (!prev || stable.length < 2) return { rows: [], guard: guarded.meta };
  const rows = ((await db.execute(sql`
    SELECT c.sector,
           SUM(CASE WHEN h.quarterDate=${cur} THEN h.shares ELSE 0 END) curShares,
           SUM(CASE WHEN h.quarterDate=${prev} THEN h.shares ELSE 0 END) prevShares,
           SUM(CASE WHEN h.quarterDate=${cur} THEN h.valueUsd ELSE 0 END) curUsd,
           SUM(CASE WHEN h.quarterDate=${prev} THEN h.valueUsd ELSE 0 END) prevUsd,
           SUM(CASE WHEN q.quarterDate=${cur} THEN q.totalValueUsd ELSE 0 END) curBook,
           SUM(CASE WHEN q.quarterDate=${prev} THEN q.totalValueUsd ELSE 0 END) prevBook
    FROM fund_holdings h
    JOIN companies c ON c.cik = h.heldCik
    LEFT JOIN fund_quarters q ON q.fundCik=h.fundCik AND q.quarterDate=h.quarterDate
    WHERE h.quarterDate IN (${cur}, ${prev}) AND h.secClass='COM' AND c.sector IS NOT NULL
      AND h.fundCik IN (${sql.join(stable.map((id) => sql`${id}`), sql`, `)})
    GROUP BY c.sector`))[0] as unknown as any[]).map((r: any) => {
    const curShares = Number(r.curShares ?? 0), prevShares = Number(r.prevShares ?? 0);
    const m = flowMetrics(curShares, prevShares, r.curBook === null ? null : Number(r.curBook), r.prevBook === null ? null : Number(r.prevBook));
    return {
      sector: String(r.sector),
      curUsd: Number(r.curUsd ?? 0),
      deltaUsd: Number(r.curUsd ?? 0) - Number(r.prevUsd ?? 0),
      curShares,
      deltaShares: m.deltaShares,
      deltaWeightPp: m.deltaWeightPp,
    };
  }).sort((a: SectorFlowRow, b: SectorFlowRow) => b.deltaShares - a.deltaShares);
  return { rows, guard: guarded.meta };
}

/** Backward-compatible shape for existing clients; rows use the same guard. */
export async function sectorFlows(): Promise<SectorFlowRow[]> {
  return (await sectorFlowsDetailed()).rows;
}
