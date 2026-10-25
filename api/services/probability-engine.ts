/**
 * 6b — per-company walk-forward probability of next-quarter up move.
 * Factor set: per-company rolling IC + reliability from calls (e_plus/e_minus
 * taxonomy), correlation dedup, macro prior from macro_points (FRED, D46).
 * Everything is availability-anchored (sourceFiled) and honest about n.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { getBars } from "./prices";
import { forwardReturn, excessForwardReturn, spearman } from "./ic";
import { bayesPosterior, reliabilityFromCalls, macroPrior, calibrationBins, zScores, familyZ, linearIdentityGroups, type Reliability } from "./probability";

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
  /** per-anchor record for the backtest table (no look-ahead anywhere) */
  points: { anchor: string; p: number; ret: number; realizedUp: boolean }[];
}

interface Pt { factor: string; filedAt: string; value: number }

export async function evaluateCompany(cik: number): Promise<ProbabilityReport | null> {
  const db = getDb();
  const [pts0]: any = await db.execute(sql`SELECT factor, filedAt, value FROM factor_points WHERE cik=${cik} AND value IS NOT NULL ORDER BY filedAt`);
  const extra = await signalSeries(cik);
  const pts = [...pts0, ...extra].sort((a, b) => String(a.filedAt).localeCompare(String(b.filedAt)));
  if (pts.length === 0) return null;
  const from = new Date(Date.now() - 25 * 365 * 86400_000).toISOString().slice(0, 10); // 25y: early anchors need real entries, not the first bar of a 7y series
  const bars = (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const spyBars = (await getBars(0, from)).filter((b) => (b.adjClose ?? b.close) !== null)
    .map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // per-factor: calls at each anchor vs realized direction + IC of values
  const byFactor = new Map<string, Pt[]>();
  for (const p of pts as Pt[]) {
    if (!byFactor.has(p.factor)) byFactor.set(p.factor, []);
    byFactor.get(p.factor)!.push(p);
  }

  /** Direction from rolling IC sign of the factor's representative series (not a hand-tuned list). */
  function lowerOf(representative: string, i: number): boolean {
    const series = byFactor.get(representative) ?? [];
    const anchors = series.slice(Math.max(0, i - 16, i));
    const xs = anchors.map((p) => Number(p.value));
    const ys = anchors.map((p) => excessForwardReturn(bars, spyBars, p.filedAt.slice(0, 10), 63)).filter((v): v is number => v !== null) as number[];
    return (spearman(xs, ys) ?? 0) < 0;
  }

  // Per-anchor rolling selection (no look-ahead): candidates, groups, and
  // reliability are computed from the trailing 8 anchors ONLY.
  function usedForAnchor(i: number) {
    const candidates: { factor: string; meanAbsIc: number; rel: Reliability; calls: { predictUp: boolean; realizedUp: boolean }[] }[] = [];
    for (const [factor, series] of byFactor) {
      const anchors = series.slice(Math.max(0, i - 16, i));
      if (anchors.length < 4) continue;
      const xs: number[] = [], ys: number[] = [];
      const calls: { predictUp: boolean; realizedUp: boolean }[] = [];
      for (const p of anchors) {
        const a = p.filedAt.slice(0, 10);
        const y = excessForwardReturn(bars, spyBars, a, 63);
        if (y === null) continue;
        const x = Number(p.value);
        const icSign = spearman(xs, ys) ?? 0;
        const predictUp = icSign >= 0 ? x > 0 : x < 0;
        calls.push({ predictUp, realizedUp: y > 0 });
        xs.push(x); ys.push(y);
      }
      const rel = reliabilityFromCalls(calls);
      if (!rel) continue;
      const meanAbsIc = Math.abs(spearman(xs, ys) ?? 0);
      if (meanAbsIc >= 0.05) candidates.push({ factor, meanAbsIc, rel, calls });
    }
    const groups = linearIdentityGroups(
      [...byFactor.entries()].map(([factor, series]) => ({ factor, values: series.slice(Math.max(0, i - 16, i)).map((p) => Number(p.value)) }))
    );
    const used: { factor: string; meanAbsIc: number; rel: Reliability; calls: { predictUp: boolean; realizedUp: boolean }[]; members: string[]; representative: string }[] = [];
    for (const g of groups) {
      const members = g.members;
      const zPerFactor = members.map((m) => ({ factor: m, z: zScores((byFactor.get(m) ?? []).slice(Math.max(0, i - 16, i)).map((p) => Number(p.value))) }));
      const anchors = byFactor.get(g.representative) ?? [];
      const familyCalls: { predictUp: boolean; realizedUp: boolean }[] = [];
      for (let j = Math.max(0, i - 8); j < i; j++) {
        if (!anchors[j]) continue;
        const a = anchors[j].filedAt.slice(0, 10);
        const z = familyZ(zPerFactor.map((f) => f.z[j - Math.max(0, i - 8)] ?? null));
        if (z === null) continue;
        const y = excessForwardReturn(bars, spyBars, a, 63);
        if (y === null) continue;
        const repSeries = byFactor.get(g.representative) ?? [];
        const repXs = anchors.map((p) => Number(p.value));
        const repYs = anchors.map((p) => forwardReturn(bars, p.filedAt.slice(0, 10), 63)).filter((v): v is number => v !== null);
        const lower = lowerOf(g.representative, i);
        familyCalls.push({ predictUp: lower ? z < 0 : z > 0, realizedUp: y > 0 });
      }
      const rel = reliabilityFromCalls(familyCalls);
      if (!rel) continue;
      const label = members.length > 1 ? members.join("+") : g.representative;
      const meanAbsIc = Math.max(...members.map((m) => candidates.find((c) => c.factor === m)?.meanAbsIc ?? 0));
      used.push({ factor: label, meanAbsIc, rel, calls: familyCalls, members, representative: g.representative });
    }
    return used;
  }

  // macro prior AS OF each anchor (no look-ahead): latest macro row per series
  // with date <= anchor date, not the latest row overall.
  async function macroPriorAt(anchor: string): Promise<number> {
    const [mac]: any = await db.execute(sql`SELECT seriesId, value, date FROM macro_points WHERE seriesId IN ('VIXCLS','BAMLH0A0HYM2','T10Y2Y') AND date <= ${anchor} ORDER BY date DESC LIMIT 3`);
    const vix = mac.find((m: any) => m.seriesId === "VIXCLS")?.value ?? null;
    const hy = mac.find((m: any) => m.seriesId === "BAMLH0A0HYM2")?.value ?? null;
    const t = mac.find((m: any) => m.seriesId === "T10Y2Y")?.value ?? null;
    return macroPrior({ vix, hySpread: hy, t10y2y: t });
  }
  const prior0 = await macroPriorAt(new Date().toISOString().slice(0, 10));

  // Sign-aware posterior per anchor (PDF formula), reliability from trailing
  // 8 calls only. No chained prior: each anchor is evaluated independently
  // with the macro prior, because the doc's Bayes is per-quarter, not a
  // self-absorbing posterior chain (that chain collapsed to 0 earlier).
  const points: { p: number; realizedUp: boolean; anchor: string; ret: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    // COOL-OFF: no predictions for the first 8 anchors of a company's history —
    // reliability is not calibrated yet (owner's explicit warm-up requirement)
    if (i < 8) continue;
    const a = pts[i].filedAt.slice(0, 10);
    const y = excessForwardReturn(bars, spyBars, a, 63);
    if (y === null) continue;
    const items = usedForAnchor(i).map((u) => {
      const lower = lowerOf(u.representative, i);
      const zPerFactor = u.members.map((m) => zScores((byFactor.get(m) ?? []).slice(Math.max(0, i - 16, i)).map((p) => Number(p.value))));
      const z = familyZ(zPerFactor.map((f) => (Array.isArray(f.z) && f.z.length > 0 ? f.z[f.z.length - 1] : null)));
      const x = (lower ? (z ?? 0) < 0 : (z ?? 0) > 0) ? 1 : -1;
      return { x: x as 1 | -1, lpp: u.rel.lpp, lmm: u.rel.lmm };
    });
    const priorAnchor = await macroPriorAt(a);
    const pUp = bayesPosterior(items, priorAnchor);
    if (pUp !== null) points.push({ p: pUp, realizedUp: y > 0, anchor: a, ret: y });
  }
  if (points.length === 0) return null;

  // report the factor set used at the LAST anchor WITH candidates (rolling
  // per-anchor sets vary; an empty final set is not a report)
  let used = usedForAnchor(pts.length - 1);
  for (let i = pts.length - 1; i >= 0 && used.length === 0; i--) used = usedForAnchor(i);
  const at60 = points.filter((p) => p.p >= 0.6);
  const below60 = points.filter((p) => p.p < 0.6);
  const current = points[points.length - 1];

  return {
    cik,
    anchors: points.length,
    factorsUsed: used.map((u) => ({ factor: u.factor, meanAbsIc: u.meanAbsIc, lpp: u.rel.lpp, lmm: u.rel.lmm })),
    currentP: current.p,
    currentAnchor: current.anchor,
    macroPrior: prior0,
    backtest: {
      n: points.length,
      baselineUpRate: points.filter((p) => p.realizedUp).length / points.length,
      hitRateAt60: at60.length ? at60.filter((p) => p.realizedUp).length / at60.length : null,
      hitRateBelow60: below60.length ? below60.filter((p) => p.realizedUp).length / below60.length : null,
      ePlus: below60.length ? below60.filter((p) => p.realizedUp).length / below60.length : null,
      eMinus: at60.length ? at60.filter((p) => !p.realizedUp).length / at60.length : null,
    },
    calibration: calibrationBins(points),
    points,
  };
}
