/**
 * 5g — institutional ownership aggregates from fund_holdings (13F pipeline).
 * Per company: shares held by the tracked fund universe, holder count,
 * quarter-over-quarter net change, top holders. Ownership % needs shares
 * outstanding from XBRL facts (dei EntityCommonStockSharesOutstanding) —
 * NULL when unknown, never guessed.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";

export interface InstitutionalSummary {
  quarterDate: string | null;
  holders: number;
  sharesHeld: number | null;
  valueUsd: number | null;
  qoqSharesDeltaPct: number | null;
  ownershipPct: number | null;
  top: { fundName: string; tier: string | null; shares: number | null; valueUsd: number | null }[];
}

export async function institutionalSummary(cik: number): Promise<InstitutionalSummary> {
  const db = getDb();
  const empty: InstitutionalSummary = { quarterDate: null, holders: 0, sharesHeld: null, valueUsd: null, qoqSharesDeltaPct: null, ownershipPct: null, top: [] };

  const [qs]: any = await db.execute(sql`SELECT DISTINCT quarterDate FROM fund_holdings WHERE heldCik=${cik} ORDER BY quarterDate DESC LIMIT 2`);
  if (qs.length === 0) return empty;
  const cur = String(qs[0].quarterDate).slice(0, 10);
  const prev = qs.length > 1 ? String(qs[1].quarterDate).slice(0, 10) : null;

  const [agg]: any = await db.execute(sql`
    SELECT COUNT(DISTINCT fundCik) holders, SUM(shares) sharesHeld, SUM(valueUsd) valueUsd
    FROM fund_holdings WHERE heldCik=${cik} AND quarterDate=${cur} AND secClass='COM'`);
  const curShares = Number(agg[0]?.sharesHeld ?? 0) || null;
  const curValue = Number(agg[0]?.valueUsd ?? 0) || null;
  const holders = Number(agg[0]?.holders ?? 0);

  let qoqSharesDeltaPct: number | null = null;
  if (prev && curShares !== null) {
    const [p]: any = await db.execute(sql`SELECT SUM(shares) s FROM fund_holdings WHERE heldCik=${cik} AND quarterDate=${prev} AND secClass='COM'`);
    const prevShares = Number(p[0]?.s ?? 0);
    if (prevShares > 0) qoqSharesDeltaPct = Math.round(((curShares - prevShares) / prevShares) * 1000) / 10;
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
    GROUP BY fundName, tier ORDER BY valueUsd DESC LIMIT 5`))[0] as any[];

  return {
    quarterDate: cur, holders, sharesHeld: curShares, valueUsd: curValue,
    qoqSharesDeltaPct, ownershipPct,
    top: top.map((t) => ({ fundName: t.fundName, tier: t.tier, shares: t.shares !== null ? Number(t.shares) : null, valueUsd: t.valueUsd !== null ? Number(t.valueUsd) : null })),
  };
}

/** Net QoQ value flow by GICS sector for the latest quarter (dashboard). */
export async function sectorFlows(): Promise<{ sector: string; deltaUsd: number; curUsd: number }[]> {
  const db = getDb();
  const [qs]: any = await db.execute(sql`SELECT DISTINCT quarterDate FROM fund_holdings ORDER BY quarterDate DESC LIMIT 2`);
  if (qs.length < 2) return [];
  const cur = String(qs[0].quarterDate).slice(0, 10);
  const prev = String(qs[1].quarterDate).slice(0, 10);
  return (await db.execute(sql`
    SELECT c.sector,
           SUM(CASE WHEN h.quarterDate=${cur} THEN h.valueUsd ELSE 0 END) curUsd,
           SUM(CASE WHEN h.quarterDate=${prev} THEN h.valueUsd ELSE 0 END) prevUsd
    FROM fund_holdings h JOIN companies c ON c.cik = h.heldCik
    WHERE h.quarterDate IN (${cur}, ${prev}) AND h.secClass='COM' AND c.sector IS NOT NULL
    GROUP BY c.sector`))[0].map((r: any) => ({
    sector: r.sector,
    curUsd: Number(r.curUsd ?? 0),
    deltaUsd: Number(r.curUsd ?? 0) - Number(r.prevUsd ?? 0),
  })).sort((a: any, b: any) => b.deltaUsd - a.deltaUsd);
}
