/**
 * 6b — per-company walk-forward probability of next-quarter up move.
 * Factor set: per-company rolling IC + reliability from calls (e_plus/e_minus
 * taxonomy), correlation dedup, macro prior from macro_points (FRED, D46).
 * Everything is availability-anchored (sourceFiled) and honest about n.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { getBars } from "./prices";
import { forwardReturn, spearman } from "./ic";
import { naiveBayesPUp, reliabilityFromCalls, macroPrior, calibrationBins, FACTOR_FAMILIES, zScores, familyZ, type Reliability } from "./probability";

// Extra factor streams beyond fundamentals (6b+): filing tone and 13F flow.
// edgarTone = LLM tone score per filing (availability = eventTs = filing time).
// smartMoneyFlow = QoQ position value change for the company (USD, normalized
// later by IC, so scale-invariant).
async function signalSeries(cik: number): Promise<Pt[]> {
  const db = getDb();
  const [tone]: any = await db.execute(sql`SELECT eventTs, score FROM signals WHERE cik=${cik} AND source='edgar' AND signalType='tone' AND score IS NOT NULL ORDER BY eventTs`);
  const [flows]: any = await db.execute(sql`
    SELECT quarterDate, SUM(valueUsd) v FROM fund_holdings
    WHERE heldCik=${cik} AND secClass='COM' GROUP BY quarterDate ORDER BY quarterDate`);
  const out: Pt[] = [];
  for (const t of tone) {
    out.push({ factor: "edgarTone", filedAt: String(t.eventTs).slice(0, 10), value: Number(t.score) });
  }
  for (let i = 1; i < flows.length; i++) {
    const cur = Number(flows[i].v ?? 0), prev = Number(flows[i - 1].v ?? 0);
    out.push({ factor: "smartMoneyFlow", filedAt: String(flows[i].quarterDate).slice(0, 10), value: prev === 0 ? 0 : (cur - prev) / prev });
  }
  return out;
}

export interface ProbabilityReport {
  cik: number;
  anchors: number;
  factorsUsed: { factor: string; meanAbsIc: number; lpp: number; lmm: number }[];
  currentP: number | null;
  currentAnchor: string | null;
  macroPrior: number;
  backtest: {
    n: number;
    baselineUpRate: number; // trivial "always up" baseline — model must beat it
    hitRateAt60: number | null; // fraction up realized among anchors with p ≥ 0.6
    hitRateBelow60: number | null;
    ePlus: number | null;  // lost-money rate among down-predictions
    eMinus: number | null; // unrealized-profit rate among up-predictions
  };
  calibration: { from: number; to: number; n: number; meanP: number; observedUp: number }[];
}

const LOWER_BETTER = new Set(["accruals", "assetGrowth", "buybackYield"]);

interface Pt { factor: string; filedAt: string; value: number }

export async function evaluateCompany(cik: number): Promise<ProbabilityReport | null> {
  const db = getDb();
  const [pts0]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
  const extra = await signalSeries(cik);
  const pts = [...pts0, ...extra].sort((a, b) => String(a.filedAt).localeCompare(String(b.filedAt)));
  if (pts.length === 0) return null;
  const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // per-factor: calls at each anchor vs realized direction + IC of values
  const byFactor = new Map<string, Pt[]>();
  for (const p of pts as Pt[]) {
    if (!byFactor.has(p.factor)) byFactor.set(p.factor, []);
    byFactor.get(p.factor)!.push(p);
  }

  const candidates: { factor: string; meanAbsIc: number; rel: Reliability }[] = [];
  for (const [factor, series] of byFactor) {
    const anchors = series.filter((p) => p.filedAt.slice(0, 10) < new Date(Date.now() - 126 * 86400_000).toISOString().slice(0, 10));
    if (anchors.length < 6) continue;
    const xs: number[] = [], ys: number[] = [];
    const calls: { predictUp: boolean; realizedUp: boolean }[] = [];
    for (const p of anchors) {
      const a = p.filedAt.slice(0, 10);
      const y = forwardReturn(bars, a, 63);
      if (y === null) continue;
      const x = Number(p.value);
      const predictUp = LOWER_BETTER.has(factor) ? x < 0 : x > 0;
      calls.push({ predictUp, realizedUp: y > 0 });
      xs.push(x); ys.push(y);
    }
    const rel = reliabilityFromCalls(calls);
    if (!rel) continue;
    const meanAbsIc = Math.abs(spearman(xs, ys) ?? 0);
    if (meanAbsIc >= 0.05) candidates.push({ factor, meanAbsIc, rel });
  }
  if (candidates.length === 0) return null;

  // 6b+ — economic families, NOT statistical dedup: one vote per family,
  // value = z-average of members (Gauss by median/IQR per factor per company).
  const byFamily = new Map<string, { factor: string; meanAbsIc: number; rel: Reliability }[]>();
  for (const c of candidates) {
    const fam = FACTOR_FAMILIES[c.factor] ?? c.factor;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(c);
  }
  const used: { factor: string; meanAbsIc: number; lpp: number; lmm: number }[] = [];
  for (const [fam, members] of byFamily) {
    // z-normalized family series: average member z at each anchor
    const zPerFactor = members.map((m) => ({ factor: m.factor, z: zScores((byFactor.get(m.factor) ?? []).map((p) => Number(p.value))) }));
    const anchors = members[0] ? (byFactor.get(members[0].factor) ?? []) : [];
    const familyCalls: { predictUp: boolean; realizedUp: boolean }[] = [];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i].filedAt.slice(0, 10);
      const z = familyZ(zPerFactor.map((f) => f.z[i] ?? null));
      if (z === null) continue;
      const y = forwardReturn(bars, a, 63);
      if (y === null) continue;
      familyCalls.push({ predictUp: LOWER_BETTER.has(fam) ? z < 0 : z > 0, realizedUp: y > 0 });
    }
    const rel = reliabilityFromCalls(familyCalls);
    if (!rel) continue;
    used.push({ factor: fam, meanAbsIc: Math.max(...members.map((m) => m.meanAbsIc)), rel });
  }

  // macro prior at the latest anchor
  const [mac]: any = await db.execute(sql`SELECT seriesId, value, date FROM macro_points WHERE seriesId IN ('VIXCLS','BAMLH0A0HYM2','T10Y2Y') ORDER BY date DESC LIMIT 3`);
  const vix = mac.find((m: any) => m.seriesId === "VIXCLS")?.value ?? null;
  const hy = mac.find((m: any) => m.seriesId === "BAMLH0A0HYM2")?.value ?? null;
  const t = mac.find((m: any) => m.seriesId === "T10Y2Y")?.value ?? null;
  const prior = macroPrior({ vix, hySpread: hy, t10y2y: t });

  // walk-forward P per anchor
  const points: { p: number; realizedUp: boolean; anchor: string }[] = [];
  for (const p of pts as Pt[]) {
    const a = p.filedAt.slice(0, 10);
    const y = forwardReturn(bars, a, 63);
    if (y === null) continue;
    const rels: Reliability[] = used.map((u) => u.rel);
    const pUp = naiveBayesPUp(rels, prior);
    if (pUp !== null) points.push({ p: pUp, realizedUp: y > 0, anchor: a });
  }
  if (points.length === 0) return null;

  const at60 = points.filter((p) => p.p >= 0.6);
  const below60 = points.filter((p) => p.p < 0.6);
  const current = points[points.length - 1];

  return {
    cik,
    anchors: points.length,
    factorsUsed: used.map((u) => ({ factor: u.factor, meanAbsIc: u.meanAbsIc, lpp: u.rel.lpp, lmm: u.rel.lmm })),
    currentP: current.p,
    currentAnchor: current.anchor,
    macroPrior: prior,
    backtest: {
      n: points.length,
      baselineUpRate: points.filter((p) => p.realizedUp).length / points.length,
      hitRateAt60: at60.length ? at60.filter((p) => p.realizedUp).length / at60.length : null,
      hitRateBelow60: below60.length ? below60.filter((p) => p.realizedUp).length / below60.length : null,
      ePlus: below60.length ? below60.filter((p) => p.realizedUp).length / below60.length : null,
      eMinus: at60.length ? at60.filter((p) => !p.realizedUp).length / at60.length : null,
    },
    calibration: calibrationBins(points),
  };
}
