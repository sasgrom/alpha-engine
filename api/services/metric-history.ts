/**
 * Metric history service (4n, D47) — pre-computes the quote-grid metrics'
 * month-end history into metric_history so the company Overview charts them
 * instantly (owner directive: "pre-calculate and store as a static table so
 * display is immediate").
 *
 * Metrics: volume (month mean of daily volume), avgVolume3m (trailing 63
 * trading days), marketCap (close × shares outstanding as-of), epsTtm
 * (trailing 4-quarter diluted EPS as-of), peTtm (close / epsTtm), beta5y
 * (rolling 60-month OLS slope vs SPY, ≥24 months — the prices.ts convention).
 *
 * Vintage note (honest): series inputs are the LATEST vintage — these are
 * exploratory displays, not backtest inputs; backtests rebuild on as-of(T).
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { externalCache, metricHistory } from "@db/schema";
import { getBars } from "./prices";
import { splitCsvRow } from "./short-interest";

/** Exact split map from the Yahoo stock-actions CSV (4n): rows with Stock Splits > 0. */
export function splitsFromActionsCsv(csvText: string): { date: string; factor: number }[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const header = splitCsvRow(lines[0]).map((h) => h.trim());
  const iDate = header.indexOf("Date");
  const iSplit = header.findIndex((h) => /stock splits/i.test(h));
  if (iDate < 0 || iSplit < 0) return [];
  const out: { date: string; factor: number }[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line);
    const f = Number(cols[iSplit]);
    const d = String(cols[iDate] ?? "").slice(0, 10);
    if (Number.isFinite(f) && f > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.push({ date: d, factor: f });
  }
  return out;
}

/** Apply an exact split map to a nominal series (desc in, desc out).
 *  Scale ONLY points that are genuinely nominal at split time: periodEnd <
 *  ex-date AND sourceFiled ≤ ex-date (later restatements already carry
 *  post-split values — scaling them again is the double-count).
 *  direction: 'up' for counts (shares ×), 'down' for per-share (EPS ÷). */
export function applySplitMap(
  seriesDesc: { periodEnd: string; val: number | null; sourceFiled?: string | null }[],
  splits: { date: string; factor: number }[],
  direction: "up" | "down" = "up"
): { periodEnd: string; val: number | null; sourceFiled?: string | null }[] {
  if (splits.length === 0) return seriesDesc;
  const sorted = [...splits].sort((a, b) => a.date.localeCompare(b.date));
  return seriesDesc.map((p) => {
    if (p.val === null) return p;
    let scale = 1;
    for (const s of sorted) {
      if (p.periodEnd < s.date && (!p.sourceFiled || p.sourceFiled <= s.date)) scale *= s.factor;
    }
    if (scale === 1) return p;
    return { ...p, val: direction === "up" ? p.val * scale : p.val / scale };
  });
}

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Trailing mean of the last `window` values ending at index i (inclusive). */
export function trailingMean(values: (number | null)[], i: number, window: number): number | null {
  if (i < 0) return null;
  let sum = 0, n = 0;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) {
    const v = values[j];
    if (Number.isFinite(v)) { sum += v as number; n++; } // undefined/NaN/null all skip honestly
  }
  return n > 0 ? sum / n : null;
}

/** OLS slope (beta) of stock returns on benchmark returns (NaN pairs skipped). */
export function olsSlope(stock: number[], bench: number[]): number | null {
  const pairs: [number, number][] = [];
  const n = Math.min(stock.length, bench.length);
  for (let i = 0; i < n; i++) {
    const s = stock[stock.length - n + i], b = bench[bench.length - n + i];
    if (Number.isFinite(s) && Number.isFinite(b)) pairs.push([s, b]);
  }
  if (pairs.length < 3) return null;
  const m = pairs.length;
  const ms = pairs.reduce((a, p) => a + p[0], 0) / m;
  const mb = pairs.reduce((a, p) => a + p[1], 0) / m;
  let cov = 0, varB = 0;
  for (const [s, b] of pairs) {
    cov += (s - ms) * (b - mb);
    varB += (b - mb) ** 2;
  }
  return varB > 0 ? cov / varB : null;
}

/** Monthly simple returns from month-end closes (non-finite pairs skipped). */
export function monthlyReturns(monthEndCloses: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < monthEndCloses.length; i++) {
    const prev = monthEndCloses[i - 1], cur = monthEndCloses[i];
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0) out.push(cur / prev - 1);
    else out.push(NaN);
  }
  return out;
}

/** Trailing-4-quarter EPS TTM as of a date (latest vintage, periodEnd ≤ T). */
export function epsTtmAsOf(epsQuarterlyDesc: { periodEnd: string; val: number | null }[], asOfDate: string): number | null {
  const vals = epsQuarterlyDesc.filter((p) => p.periodEnd <= asOfDate && p.val !== null).slice(0, 4);
  return vals.length === 4 ? vals.reduce((s, p) => s + (p.val as number), 0) : null;
}

/** Latest shares-outstanding value as of a date (series point ≤ T). */
export function valueAsOf(seriesDesc: { periodEnd: string; val: number | null }[], asOfDate: string): number | null {
  const hit = seriesDesc.find((p) => p.periodEnd <= asOfDate && p.val !== null);
  return hit?.val ?? null;
}

/**
 * Normalize a share-count series to the LATEST split basis (4n): our prices
 * are split-adjusted, XBRL share counts are nominal at the time — mixing them
 * breaks market cap across every split (AAPL 4:1 2020 read 4× too small
 * before it). Walking newest → oldest, a drop by a round split factor
 * (2/3/4/5/7/10 within 5%) scales all older values up. Gradual buyback
 * declines never hit the snap rule (they are not round factors).
 * Input desc by periodEnd; output desc, normalized.
 */
export function normalizeShareSplits<T extends { periodEnd: string; val: number | null; sourceFiled?: string | null }>(seriesDesc: T[]): T[] {
  const out = seriesDesc.map((p) => ({ ...p }));
  const SNAP = [2, 3, 4, 5, 7, 10];
  let scale = 1;
  for (let i = 0; i < out.length - 1; i++) {
    const newer = out[i].val;
    const older = out[i + 1].val;
    if (newer !== null && older !== null && newer > 0) {
      const ratio = older / (newer * scale);
      const snapped = SNAP.find((f) => Math.abs(ratio / f - 1) < 0.05);
      if (snapped && snapped > 1) scale *= snapped; // a split sits between i and i+1
    }
    if (scale !== 1 && out[i + 1].val !== null) out[i + 1].val = out[i + 1].val! * scale;
  }
  return out;
}

/** Month-end date list covered by the bars (YYYY-MM-DD, last calendar day with data). */
export function monthEnds(dates: string[]): string[] {
  const seen = new Set<string>();
  for (const d of dates) seen.add(d.slice(0, 7));
  return [...seen].sort().map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); // last day of the month
  });
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

export const METRIC_KEYS = ["volume", "avgVolume3m", "marketCap", "epsTtm", "peTtm", "beta5y"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

async function quarterlySeries(cik: number, concept: string): Promise<{ periodEnd: string; val: number | null; sourceFiled: string | null }[]> {
  const rows: any = await getDb().execute(sql`
    SELECT periodEnd, val, sourceFiled FROM series_points
    WHERE cik=${cik} AND concept=${concept} AND vintage='latest'
    ORDER BY periodEnd DESC LIMIT 120`);
  return (rows[0] as any[]).map((r) => ({ periodEnd: String(r.periodEnd).slice(0, 10), val: r.val === null ? null : Number(r.val), sourceFiled: r.sourceFiled ? String(r.sourceFiled).slice(0, 10) : null }));
}

/** Precompute one company's metric history (month-end points, full depth). */
export async function computeCompanyMetricHistory(cik: number): Promise<{ metric: string; points: number }[]> {
  const db = getDb();
  const bars = await getBars(cik, "1900-01-01");
  const spy = await getBars(0, "1900-01-01");
  const epsQ = await quarterlySeries(cik, "EarningsPerShareDiluted");
  // shares: prefer the instant outstanding concept; some filers tag only the
  // diluted-average flow (T) — fall back honestly (display-level anyway)
  let sharesQ: { periodEnd: string; val: number | null; sourceFiled?: string | null }[] =
    await quarterlySeries(cik, "CommonStockSharesOutstanding");
  if (sharesQ.every((p) => p.val === null)) {
    sharesQ = await quarterlySeries(cik, "WeightedAverageNumberOfDilutedSharesOutstanding");
  }
  // 4n: XBRL share counts are nominal-at-the-time; our prices are split-
  // adjusted. The EXACT split map (Yahoo stock actions, cached as
  // splits:<cik>) normalizes shares to the latest basis; without it the
  // heuristic runs (restatement spikes can fake a ratio — exact wins).
  const [splitRow] = await db.select().from(externalCache).where(eq(externalCache.key, `splits:${cik}`)).limit(1);
  let splits: { date: string; factor: number }[] = [];
  try { splits = splitRow?.payload ? JSON.parse(splitRow.payload) : []; } catch { splits = []; }
  sharesQ = splits.length > 0 ? applySplitMap(sharesQ, splits, "up") : normalizeShareSplits(sharesQ);
  // EPS is split-restated the same way but scales DOWN (per-share ÷ factor)
  const epsQN = splits.length > 0 ? applySplitMap(epsQ, splits, "down") : epsQ;

  const closes = bars.map((b) => (b.adjClose ?? b.close) as number | null);
  const dates = bars.map((b) => b.date);
  const volumes = bars.map((b) => (b.volume === null ? null : Number(b.volume)));
  const months = monthEnds(dates);

  // SPY month-end closes aligned to our months (nearest bar ≤ month-end)
  const spyCloseAt = (t: string): number | null => {
    let v: number | null = null;
    for (const b of spy) { if (b.date <= t) v = (b.adjClose ?? b.close) as number; else break; }
    return v;
  };

  const rows: { metric: MetricKey; date: string; value: number | null }[] = [];
  const monthlyCloses: number[] = [];
  const spyMonthly: (number | null)[] = [];

  for (const me of months) {
    // last bar index ≤ month-end
    let i = -1;
    for (let k = 0; k < dates.length; k++) { if (dates[k] <= me) i = k; else break; }
    if (i < 0) { monthlyCloses.push(NaN); spyMonthly.push(null); continue; }
    const close = closes[i];
    monthlyCloses.push(close ?? NaN);
    spyMonthly.push(spyCloseAt(me));

    // volume: mean of the month's daily volumes
    const monthPrefix = me.slice(0, 7);
    let vSum = 0, vN = 0;
    for (let k = 0; k < dates.length; k++) {
      if (dates[k].startsWith(monthPrefix) && volumes[k] !== null) { vSum += volumes[k] as number; vN++; }
    }
    rows.push({ metric: "volume", date: me, value: vN > 0 ? vSum / vN : null });
    rows.push({ metric: "avgVolume3m", date: me, value: trailingMean(volumes, i, 63) });

    const shares = valueAsOf(sharesQ, me);
    const mcap = close !== null && shares !== null ? close * shares : null;
    rows.push({ metric: "marketCap", date: me, value: mcap });

    const epsT = epsTtmAsOf(epsQN, me);
    rows.push({ metric: "epsTtm", date: me, value: epsT });
    rows.push({ metric: "peTtm", date: me, value: close !== null && epsT !== null && epsT !== 0 ? close / epsT : null });
  }

  // rolling 60-month OLS beta vs SPY (needs ≥24 months — the beta5y convention)
  const stockRets = monthlyReturns(monthlyCloses.map((c) => (Number.isFinite(c) ? c : NaN)));
  const spyRets = monthlyReturns(spyMonthly.map((c) => (c ?? NaN)));
  months.forEach((me, idx) => {
    if (idx === 0) return; // no returns before the first month
    const s = stockRets.slice(Math.max(0, idx - 60), idx);
    const b = spyRets.slice(Math.max(0, idx - 60), idx);
    const pairs = s.length >= 24 ? Math.min(s.length, b.length) : 0;
    rows.push({
      metric: "beta5y",
      date: me,
      value: pairs >= 24 ? olsSlope(s.slice(-pairs), b.slice(-pairs)) : null,
    });
  });

  // replace per company (idempotent rebuild)
  await db.delete(metricHistory).where(eq(metricHistory.cik, cik));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(metricHistory).values(rows.slice(i, i + CHUNK).map((r) => ({ cik, ...r })));
  }
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.metric, (counts.get(r.metric) ?? 0) + (r.value !== null ? 1 : 0));
  return METRIC_KEYS.map((m) => ({ metric: m, points: counts.get(m) ?? 0 }));
}
