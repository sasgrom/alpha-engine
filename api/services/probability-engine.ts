/**
 * 6b/6c — availability-anchored next-quarter probability engine.
 * Every anchor uses one shared calendar, only information available at that
 * date, and only training labels whose 63-session exit is already in the past.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { getBars } from "./prices";
import { excessForwardReturnInfo, spearman, type ForwardReturnInfo } from "./ic";
import {
  bayesPosterior,
  reliabilityFromCalls,
  macroPrior,
  calibrationBins,
  zScores,
  familyZ,
  linearIdentityGroups,
  type Reliability,
} from "./probability";

export interface Bar { date: string; close: number }
export interface Pt { factor: string; periodEnd: string; filedAt: string; value: number }
export interface UsedFactor {
  factor: string;
  meanAbsIc: number;
  rel: Reliability;
  members: string[];
  representative: string;
  direction: 1 | -1;
}

export interface EngineData {
  cik: number;
  asOf: string;
  anchors: string[];
  byFactor: Map<string, Pt[]>;
  values: Map<string, (number | null)[]>;
  zValues: Map<string, (number | null)[]>;
  outcomes: (ForwardReturnInfo | null)[];
  bars: Bar[];
  spyBars: Bar[];
  macroPriorAt: (anchor: string) => Promise<number>;
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
    baselineUpRate: number;
    hitRateAt60: number | null;
    hitRateBelow60: number | null;
    ePlus: number | null;
    eMinus: number | null;
  };
  calibration: { from: number; to: number; n: number; meanP: number; observedUp: number }[];
  points: { anchor: string; p: number; ret: number; realizedUp: boolean }[];
}

const TRAILING = 16;
const COOL_OFF = 8;
const HORIZON = 63;

function dateOnly(v: unknown): string { return String(v).slice(0, 10); }
function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

/** Extra streams. 13F uses the legal 45-day availability lag until filingDate
 * is persisted per accession; quarter-end itself is never used as availability. */
async function signalSeries(cik: number): Promise<Pt[]> {
  const db = getDb();
  const [tone]: any = await db.execute(sql`SELECT eventTs, score FROM signals WHERE cik=${cik} AND source='edgar' AND signalType='tone' AND score IS NOT NULL ORDER BY eventTs`);
  const [flows]: any = await db.execute(sql`
    SELECT quarterDate, SUM(valueUsd) v FROM fund_holdings
    WHERE heldCik=${cik} AND secClass='COM' GROUP BY quarterDate ORDER BY quarterDate`);
  const out: Pt[] = [];
  for (const t of tone) {
    const a = dateOnly(t.eventTs);
    out.push({ factor: "edgarTone", periodEnd: a, filedAt: a, value: Number(t.score) });
  }
  for (let i = 1; i < flows.length; i++) {
    const q = dateOnly(flows[i].quarterDate);
    const cur = Number(flows[i].v ?? 0), prev = Number(flows[i - 1].v ?? 0);
    out.push({ factor: "smartMoneyFlow", periodEnd: q, filedAt: plusDays(q, 45), value: prev === 0 ? 0 : (cur - prev) / prev });
  }
  return out.filter((p) => Number.isFinite(p.value));
}

/** Collapse duplicate observations released on one date. Fundamentals use the
 * latest period released then; repeated values for that same period average. */
export function normalizeFactorPoints(raw: Pt[]): Map<string, Pt[]> {
  const grouped = new Map<string, Map<string, Pt[]>>();
  for (const p of raw) {
    if (!p.filedAt || !Number.isFinite(p.value)) continue;
    if (!grouped.has(p.factor)) grouped.set(p.factor, new Map());
    const byDate = grouped.get(p.factor)!;
    if (!byDate.has(p.filedAt)) byDate.set(p.filedAt, []);
    byDate.get(p.filedAt)!.push(p);
  }
  const out = new Map<string, Pt[]>();
  for (const [factor, byDate] of grouped) {
    const series: Pt[] = [];
    for (const [filedAt, rows] of byDate) {
      const latestPeriod = rows.map((r) => r.periodEnd).sort().at(-1) ?? filedAt;
      const latest = rows.filter((r) => r.periodEnd === latestPeriod);
      const value = latest.reduce((a, r) => a + r.value, 0) / latest.length;
      series.push({ factor, periodEnd: latestPeriod, filedAt, value });
    }
    out.set(factor, series.sort((a, b) => a.filedAt.localeCompare(b.filedAt)));
  }
  return out;
}

export function buildEngineData(
  cik: number,
  asOf: string,
  rawPoints: Pt[],
  bars: Bar[],
  spyBars: Bar[],
  macroPriorAt: (anchor: string) => Promise<number>
): EngineData {
  const eligible = rawPoints.filter((p) => p.filedAt <= asOf && p.filedAt !== "");
  const byFactor = normalizeFactorPoints(eligible);
  const anchors = [...new Set([...byFactor.values()].flatMap((s) => s.map((p) => p.filedAt)))].sort();
  const values = new Map<string, (number | null)[]>();
  const zValues = new Map<string, (number | null)[]>();
  for (const [factor, series] of byFactor) {
    const raw: (number | null)[] = [], zs: (number | null)[] = [];
    let obs = -1;
    for (const anchor of anchors) {
      while (obs + 1 < series.length && series[obs + 1].filedAt <= anchor) obs++;
      raw.push(obs >= 0 ? series[obs].value : null);
      if (obs < 0) { zs.push(null); continue; }
      const history = series.slice(Math.max(0, obs - TRAILING + 1), obs + 1).map((p) => p.value);
      zs.push(zScores(history)[history.length - 1] ?? null);
    }
    values.set(factor, raw);
    zValues.set(factor, zs);
  }
  const outcomes = anchors.map((a) => excessForwardReturnInfo(bars, spyBars, a, HORIZON));
  return { cik, asOf, anchors, byFactor, values, zValues, outcomes, bars, spyBars, macroPriorAt };
}

export async function engineData(cik: number): Promise<EngineData> {
  const db = getDb();
  const asOf = new Date().toISOString().slice(0, 10);
  // Read-side repair for rows materialized by the old availability rule. New
  // materialization writes the same effective dates directly.
  const [fundamental]: any = await db.execute(sql`
    SELECT fp.factor, fp.periodEnd, fp.value,
      CASE WHEN fp.factor IN ('momentum122','high52') THEN fp.periodEnd
        ELSE COALESCE((SELECT MIN(f.filed) FROM facts f WHERE f.cik=fp.cik AND f.endDate=fp.periodEnd), fp.filedAt)
      END AS availableAt
    FROM factor_points fp WHERE fp.cik=${cik} AND fp.value IS NOT NULL
    ORDER BY fp.factor, availableAt, fp.periodEnd`);
  const base: Pt[] = fundamental.map((p: any) => ({
    factor: String(p.factor), periodEnd: dateOnly(p.periodEnd), filedAt: dateOnly(p.availableAt), value: Number(p.value),
  }));
  const extra = await signalSeries(cik);
  const from = plusDays(asOf, -25 * 365);
  const cleanBars = async (id: number): Promise<Bar[]> => (await getBars(id, from))
    .filter((b) => (b.adjClose ?? b.close) !== null && b.date <= asOf)
    .map((b) => ({ date: b.date, close: Number(b.adjClose ?? b.close) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const [bars, spyBars] = await Promise.all([cleanBars(cik), cleanBars(0)]);

  async function macroPriorAt(anchor: string): Promise<number> {
    const [mac]: any = await db.execute(sql`
      SELECT m.seriesId, m.value, m.date FROM macro_points m
      INNER JOIN (
        SELECT seriesId, MAX(date) md FROM macro_points
        WHERE seriesId IN ('VIXCLS','BAMLH0A0HYM2','T10Y2Y') AND date <= ${anchor}
        GROUP BY seriesId
      ) q ON q.seriesId=m.seriesId AND q.md=m.date`);
    const value = (id: string) => {
      const v = mac.find((m: any) => m.seriesId === id)?.value;
      return v === null || v === undefined ? null : Number(v);
    };
    return macroPrior({ vix: value("VIXCLS"), hySpread: value("BAMLH0A0HYM2"), t10y2y: value("T10Y2Y") });
  }
  return buildEngineData(cik, asOf, [...base, ...extra], bars, spyBars, macroPriorAt);
}

function labelKnownBy(outcome: ForwardReturnInfo, predictionDate: string): boolean {
  // Dates have no intraday timestamp, so an exit on the prediction date itself
  // is conservatively treated as not yet known.
  return outcome.exitDate < predictionDate;
}

function trainingIndexes(data: EngineData, i: number, members: string[], family: boolean): number[] {
  const out: number[] = [];
  for (let j = i - 1; j >= 0 && out.length < TRAILING; j--) {
    const outcome = data.outcomes[j];
    if (!outcome || !labelKnownBy(outcome, data.anchors[i])) continue;
    if (family) {
      const z = familyZ(members.map((m) => data.zValues.get(m)?.[j] ?? null));
      if (z === null) continue;
    } else {
      const factor = members[0];
      if ((data.values.get(factor)?.[j] ?? null) === null || (data.zValues.get(factor)?.[j] ?? null) === null) continue;
    }
    out.push(j);
  }
  return out.reverse();
}

function familyValueAt(data: EngineData, members: string[], i: number): number | null {
  return familyZ(members.map((m) => data.zValues.get(m)?.[i] ?? null));
}

/** Rolling factor selection. No target whose exit was unknown at anchor i is
 * used for IC, direction, identity grouping, or reliability estimation. */
export function usedForAnchor(data: EngineData, i: number): UsedFactor[] {
  if (i < COOL_OFF || i >= data.anchors.length) return [];
  const candidates: { factor: string; meanAbsIc: number; direction: 1 | -1 }[] = [];
  for (const factor of data.byFactor.keys()) {
    const idx = trainingIndexes(data, i, [factor], false);
    if (idx.length < 4) continue;
    const xs = idx.map((j) => data.values.get(factor)![j] as number);
    const ys = idx.map((j) => data.outcomes[j]!.ret);
    const ic = spearman(xs, ys);
    if (ic === null || Math.abs(ic) < 0.05) continue;
    candidates.push({ factor, meanAbsIc: Math.abs(ic), direction: ic >= 0 ? 1 : -1 });
  }
  candidates.sort((a, b) => b.meanAbsIc - a.meanAbsIc);
  if (candidates.length === 0) return [];

  const start = Math.max(0, i - TRAILING);
  const groups = linearIdentityGroups(candidates.map((c) => ({
    factor: c.factor,
    values: (data.values.get(c.factor) ?? []).slice(start, i),
  })));
  const used: UsedFactor[] = [];
  for (const g of groups) {
    const members = g.members.filter((m) => candidates.some((c) => c.factor === m));
    if (members.length === 0) continue;
    const idx = trainingIndexes(data, i, members, true);
    if (idx.length < 4) continue;
    const xs = idx.map((j) => familyValueAt(data, members, j) as number);
    const ys = idx.map((j) => data.outcomes[j]!.ret);
    const ic = spearman(xs, ys);
    if (ic === null || Math.abs(ic) < 0.05) continue;
    const direction: 1 | -1 = ic >= 0 ? 1 : -1;
    const calls = idx.map((j) => {
      const z = familyValueAt(data, members, j) as number;
      return { predictUp: direction === 1 ? z > 0 : z < 0, realizedUp: data.outcomes[j]!.ret > 0 };
    });
    const rel = reliabilityFromCalls(calls);
    if (!rel) continue;
    const representative = members
      .map((m) => candidates.find((c) => c.factor === m)!)
      .sort((a, b) => b.meanAbsIc - a.meanAbsIc)[0].factor;
    used.push({
      factor: members.length > 1 ? members.join("+") : representative,
      meanAbsIc: Math.abs(ic), rel, members, representative, direction,
    });
  }
  return used;
}

export function voteAt(data: EngineData, used: UsedFactor, i: number): { x: 1 | -1; lpp: number; lmm: number } | null {
  const z = familyValueAt(data, used.members, i);
  if (z === null) return null;
  const predictUp = used.direction === 1 ? z > 0 : z < 0;
  return { x: predictUp ? 1 : -1, lpp: used.rel.lpp, lmm: used.rel.lmm };
}

export async function evaluateCompany(cik: number): Promise<ProbabilityReport | null> {
  const data = await engineData(cik);
  if (data.anchors.length === 0) return null;
  const points: ProbabilityReport["points"] = [];
  let currentP: number | null = null, currentAnchor: string | null = null;
  let lastUsed: UsedFactor[] = [];
  for (let i = COOL_OFF; i < data.anchors.length; i++) {
    const selected = usedForAnchor(data, i);
    if (selected.length > 0) lastUsed = selected;
    const items = selected.map((u) => voteAt(data, u, i)).filter((v): v is NonNullable<typeof v> => v !== null);
    if (items.length === 0) continue;
    const p = bayesPosterior(items, await data.macroPriorAt(data.anchors[i]));
    if (p === null) continue;
    currentP = p;
    currentAnchor = data.anchors[i];
    const outcome = data.outcomes[i];
    if (outcome) points.push({ p, realizedUp: outcome.ret > 0, anchor: data.anchors[i], ret: outcome.ret });
  }
  if (points.length === 0) return null;
  const at60 = points.filter((p) => p.p >= 0.6);
  const below60 = points.filter((p) => p.p < 0.6);
  return {
    cik,
    anchors: points.length,
    factorsUsed: lastUsed.map((u) => ({ factor: u.factor, meanAbsIc: u.meanAbsIc, lpp: u.rel.lpp, lmm: u.rel.lmm })),
    currentP,
    currentAnchor,
    macroPrior: await data.macroPriorAt(data.asOf),
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
