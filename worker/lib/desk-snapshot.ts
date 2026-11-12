/**
 * Pure computations behind the desk snapshot (contracts/desk-snapshot.ts). The builder script does the reading;
 * everything here is deterministic and unit-tested.
 *
 * Price rule: the stored Stooq series (split and dividend adjusted) is the history; stored Schwab daily bars are
 * used only for dates after the last Stooq date of the same series, so the two adjustments never alternate.
 */
import {
  DESK_SNAPSHOT_SCHEMA_VERSION,
  type DeskBreadth,
  type DeskCompany,
  type DeskInsiderSummary,
  type DeskOptions,
  type DeskReturns,
  type DeskSector,
  type DeskShortInterest,
  type DeskSnapshot,
  type DeskSnapshotInputs,
} from "../../contracts/desk-snapshot";

export interface StoredCloseRow {
  date: string;
  close: number | null;
  source: string;
}

export interface Close {
  date: string;
  close: number;
}

const DAY_MS = 86_400_000;
const SPARK_LENGTH = 63;
/** A look-back base further than this from its anchor date is treated as missing, not as a long-gone close. */
const MAX_BASE_GAP_DAYS = 10;

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------
function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Calendar month shift; the day is clamped to the target month's last day (31 Mar − 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const day = Number(date.slice(8, 10));
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

// ---------------------------------------------------------------------------
// series
// ---------------------------------------------------------------------------
/** Stooq history plus Schwab bars after the last Stooq date; ascending, one close per date, positive closes only. */
export function spliceCloses(rows: StoredCloseRow[]): Close[] {
  let lastStooq = "";
  for (const row of rows) if (row.source === "stooq" && row.date > lastStooq) lastStooq = row.date;
  const byDate = new Map<string, number>();
  for (const row of rows) if (row.source === "stooq" && row.close !== null) byDate.set(row.date, row.close);
  for (const row of rows) if (row.source === "schwab" && row.close !== null && row.date > lastStooq) byDate.set(row.date, row.close);
  return [...byDate]
    .filter(([, close]) => Number.isFinite(close) && close > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

/** Latest close dated on or before `date` (binary search on an ascending series). */
export function closeOnOrBefore(series: Close[], date: string): Close | null {
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (series[mid].date <= date) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found >= 0 ? series[found] : null;
}

function lookbackReturn(series: Close[], end: number, anchor: string): number | null {
  const base = closeOnOrBefore(series, anchor);
  if (!base || daysBetween(base.date, anchor) > MAX_BASE_GAP_DAYS) return null;
  return end / base.close - 1;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundPrice(value: number): number {
  return value >= 1 ? Math.round(value * 100) / 100 : Math.round(value * 10_000) / 10_000;
}

export interface SeriesMetrics {
  close: number;
  lastDate: string;
  returns: DeskReturns;
  high52: number | null;
  low52: number | null;
  /** The series covers the whole 52-week window (needed before calling a close a 52-week high or low). */
  fullYear: boolean;
  ma50: number | null;
  ma200: number | null;
  vol20: number | null;
  spark: number[];
}

const NO_RETURNS: DeskReturns = { d1: null, w1: null, m1: null, m3: null, ytd: null, y1: null };

/**
 * Metrics of one series at the snapshot session. A series whose last close is older than the session keeps its
 * close and range but gets no returns: comparing it with the other series would mix dates.
 */
export function seriesMetrics(series: Close[], session: string, previousSession: string | null): SeriesMetrics | null {
  const last = series.at(-1);
  if (!last) return null;
  const current = last.date === session;
  const prior = series.at(-2);
  const returns: DeskReturns = current
    ? {
        d1: previousSession && prior?.date === previousSession ? last.close / prior.close - 1 : null,
        w1: lookbackReturn(series, last.close, addDays(session, -7)),
        m1: lookbackReturn(series, last.close, addMonths(session, -1)),
        m3: lookbackReturn(series, last.close, addMonths(session, -3)),
        ytd: lookbackReturn(series, last.close, `${Number(session.slice(0, 4)) - 1}-12-31`),
        y1: lookbackReturn(series, last.close, addMonths(session, -12)),
      }
    : { ...NO_RETURNS };
  const yearStart = addMonths(last.date, -12);
  const window = series.filter((point) => point.date > yearStart).map((point) => point.close);
  const closes = series.map((point) => point.close);
  let vol20: number | null = null;
  if (closes.length >= 21) {
    const logs = closes.slice(-21).map((close, index, list) => (index === 0 ? 0 : Math.log(close / list[index - 1]))).slice(1);
    const average = mean(logs);
    vol20 = Math.sqrt(logs.reduce((sum, value) => sum + (value - average) ** 2, 0) / (logs.length - 1)) * Math.sqrt(252);
  }
  return {
    close: last.close,
    lastDate: last.date,
    returns,
    high52: window.length ? Math.max(...window) : null,
    low52: window.length ? Math.min(...window) : null,
    fullYear: series[0].date <= addDays(yearStart, MAX_BASE_GAP_DAYS),
    ma50: closes.length >= 50 ? mean(closes.slice(-50)) : null,
    ma200: closes.length >= 200 ? mean(closes.slice(-200)) : null,
    vol20,
    spark: closes.slice(-SPARK_LENGTH).map(roundPrice),
  };
}

/** Latest date reached by at least half of the series, and the trading date before it in the calendar. */
export function resolveSession(lastDates: string[], calendar: string[]): { session: string; previousSession: string | null } | null {
  if (!lastDates.length) return null;
  const counts = new Map<string, number>();
  for (const date of lastDates) counts.set(date, (counts.get(date) ?? 0) + 1);
  // A series ending on a date also covers every earlier date: count, from the newest date down, how many reached it.
  const dates = [...counts.keys()].sort().reverse();
  let reached = 0;
  let session: string | null = null;
  for (const date of dates) {
    reached += counts.get(date)!;
    if (reached * 2 >= lastDates.length) {
      session = date;
      break;
    }
  }
  if (!session) return null;
  const previousSession = [...calendar].sort().reverse().find((date) => date < session!) ?? null;
  return { session, previousSession };
}

// ---------------------------------------------------------------------------
// earnings
// ---------------------------------------------------------------------------
/** Close before the report day to the close of the session after it; the report day alone when that is all there is. */
export function earningsReaction(series: Close[], reportDate: string): { reaction: number; sessions: 1 | 2 } | null {
  const before = closeOnOrBefore(series, addDays(reportDate, -1));
  if (!before) return null;
  const after = series.find((point) => point.date > reportDate);
  if (after) return { reaction: after.close / before.close - 1, sessions: 2 };
  const onDay = series.find((point) => point.date === reportDate);
  return onDay ? { reaction: onDay.close / before.close - 1, sessions: 1 } : null;
}

/** Return from the close that ends the reaction window (the first session after the report) to the latest close. */
export function earningsDrift(series: Close[], reportDate: string): { drift: number; sessions: number } | null {
  const start = series.findIndex((point) => point.date > reportDate);
  if (start < 0 || start >= series.length - 1) return null;
  return { drift: series[series.length - 1].close / series[start].close - 1, sessions: series.length - 1 - start };
}

/** Close a month before the session against the close a year before it; null when either base is missing. */
export function momentum12m1(series: Close[], session: string): number | null {
  const recent = closeOnOrBefore(series, addMonths(session, -1));
  const old = closeOnOrBefore(series, addMonths(session, -12));
  if (!recent || !old || daysBetween(old.date, addMonths(session, -12)) > MAX_BASE_GAP_DAYS) return null;
  return recent.close / old.close - 1;
}

export interface ShortInterestRow {
  date: string;
  shares: number | null;
  pctFloat: number | null;
  daysToCover: number | null;
}

/** Latest reading and the change in shares short from the one before it. */
export function shortInterestSummary(rows: ShortInterestRow[]): DeskShortInterest | null {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  if (!latest) return null;
  const prior = sorted.find((row) => row.date < latest.date && row.shares !== null && row.shares > 0);
  return {
    date: latest.date,
    shares: latest.shares,
    pctFloat: latest.pctFloat,
    daysToCover: latest.daysToCover,
    changePct: latest.shares !== null && prior?.shares ? latest.shares / prior.shares - 1 : null,
  };
}

export interface InsiderTradeRow {
  date: string;
  code: string;
  insider: string | null;
  shares: number | null;
  price: number | null;
  plan: boolean;
}

/** Form 4 rows on or after `since`: open-market purchases outside trading plans, and open-market sales. */
export function insiderSummary(rows: InsiderTradeRow[], since: string): DeskInsiderSummary | null {
  const recent = rows.filter((row) => row.date >= since);
  if (!recent.length) return null;
  const usd = (row: InsiderTradeRow) => (row.shares !== null && row.price !== null ? row.shares * row.price : 0);
  const buys = recent.filter((row) => row.code === "P" && !row.plan);
  const sells = recent.filter((row) => row.code === "S");
  return {
    buys: buys.length,
    buyers: new Set(buys.map((row) => (row.insider ?? "").trim().toUpperCase())).size,
    buyUsd: buys.reduce((sum, row) => sum + usd(row), 0),
    lastBuy: buys.map((row) => row.date).sort().at(-1) ?? null,
    sells: sells.length,
    sellUsd: sells.reduce((sum, row) => sum + usd(row), 0),
  };
}

/**
 * Projected next report: the report of the same quarter a year earlier plus 52 weeks (same weekday) when the
 * history has one within three weeks of the expected spot, otherwise the last report plus 13 weeks. A projection
 * that is not after the session is dropped: the company has probably reported and the data has not caught up.
 */
export function projectNextEarnings(history: string[], last: string | null, session: string): { date: string; basis: "history" | "cadence" } | null {
  if (!last) return null;
  const cadence = addDays(last, 91);
  const yearEarlier = addDays(cadence, -364);
  const match = history
    .filter((date) => date < last && Math.abs(daysBetween(date, yearEarlier)) <= 21)
    .sort((a, b) => Math.abs(daysBetween(a, yearEarlier)) - Math.abs(daysBetween(b, yearEarlier)))[0];
  const projected = match ? addDays(match, 364) : cadence;
  if (projected <= session || daysBetween(last, projected) < 28) return null;
  return { date: projected, basis: match ? "history" : "cadence" };
}

// ---------------------------------------------------------------------------
// Schwab inputs
// ---------------------------------------------------------------------------
export function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface DeskFundamentals {
  marketCap: number | null;
  pe: number | null;
  beta: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  lastEarnings: string | null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fields of a Schwab instruments file ({instruments:[{fundamental}]}) and a quotes file ({SYMBOL:{fundamental}}). */
export function schwabFundamentals(instrumentFile: any, quoteFile: any): DeskFundamentals {
  const fundamental = instrumentFile?.instruments?.[0]?.fundamental ?? null;
  const quote = quoteFile && typeof quoteFile === "object" ? (Object.values(quoteFile)[0] as any) : null;
  const yieldPct = finite(fundamental?.dividendYield ?? quote?.fundamental?.divYield);
  const lastEarnings = String(quote?.fundamental?.lastEarningsDate ?? "").slice(0, 10);
  return {
    marketCap: positive(fundamental?.marketCap),
    pe: positive(fundamental?.peRatio ?? quote?.fundamental?.peRatio),
    beta: finite(fundamental?.beta),
    dividendYield: yieldPct === null ? null : Math.max(0, yieldPct) / 100,
    epsTtm: finite(fundamental?.epsTTM),
    lastEarnings: /^\d{4}-\d{2}-\d{2}$/.test(lastEarnings) ? lastEarnings : null,
  };
}

/** One ticker of public/reports/schwab-features.json. */
export function deskOptions(feature: any): DeskOptions | null {
  if (!feature || !Array.isArray(feature.buckets)) return null;
  return {
    capturedAt: String(feature.capturedAt ?? ""),
    rv20: finite(feature.rv20),
    ivRvSpread: finite(feature.ivRvspread),
    buckets: feature.buckets.map((bucket: any) => ({
      bucket: String(bucket.bucket),
      days: Number(bucket.dte),
      atmIv: finite(bucket.atmIv),
      expectedMovePct: finite(bucket.expectedMovePct),
      skew25: finite(bucket.skew25),
      putCallOiRatio: finite(bucket.putCallOiRatio),
    })),
  };
}

// ---------------------------------------------------------------------------
// aggregates
// ---------------------------------------------------------------------------
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeBreadth(companies: DeskCompany[], fullYear: Set<string>): DeskBreadth {
  const moves = companies.map((company) => company.returns.d1).filter((value): value is number => value !== null);
  const current = companies.filter((company) => company.returns.d1 !== null);
  const withMa50 = current.filter((company) => company.ma50 !== null);
  const withMa200 = current.filter((company) => company.ma200 !== null);
  const yearSeries = current.filter((company) => fullYear.has(company.ticker));
  return {
    measured: moves.length,
    advancers: moves.filter((move) => move > 0).length,
    decliners: moves.filter((move) => move < 0).length,
    unchanged: moves.filter((move) => move === 0).length,
    medianChange: median(moves),
    newHighs: yearSeries.filter((company) => company.high52 !== null && company.close >= company.high52).length,
    newLows: yearSeries.filter((company) => company.low52 !== null && company.close <= company.low52).length,
    aboveMa50: withMa50.filter((company) => company.close > company.ma50!).length,
    withMa50: withMa50.length,
    aboveMa200: withMa200.filter((company) => company.close > company.ma200!).length,
    withMa200: withMa200.length,
  };
}

export function computeSectors(companies: DeskCompany[]): DeskSector[] {
  const groups = new Map<string, DeskCompany[]>();
  for (const company of companies) groups.set(company.sector, [...(groups.get(company.sector) ?? []), company]);
  return [...groups]
    .map(([name, members]) => {
      const returns = { ...NO_RETURNS };
      for (const period of Object.keys(returns) as (keyof DeskReturns)[]) {
        let weight = 0;
        let sum = 0;
        for (const member of members) {
          const value = member.returns[period];
          if (value === null || member.marketCap === null) continue;
          weight += member.marketCap;
          sum += member.marketCap * value;
        }
        returns[period] = weight > 0 ? sum / weight : null;
      }
      return {
        name,
        companies: members.length,
        marketCap: members.reduce((total, member) => total + (member.marketCap ?? 0), 0),
        returns,
        advancers: members.filter((member) => (member.returns.d1 ?? 0) > 0).length,
        decliners: members.filter((member) => (member.returns.d1 ?? 0) < 0).length,
      };
    })
    .sort((a, b) => b.marketCap - a.marketCap || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------
export interface DeskCompanyInput {
  cik: number;
  ticker: string;
  registryTicker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  research: boolean;
}

export interface DeskBuildInput {
  generatedAt: string;
  codeVersion: string;
  companies: DeskCompanyInput[];
  /** Spliced closes per cik. */
  closes: Map<number, Close[]>;
  benchmark: { ticker: string; closes: Close[] } | null;
  /** Keyed by normalizeTicker(). */
  fundamentals: Map<string, DeskFundamentals>;
  options: Map<string, DeskOptions>;
  /** Stored earnings event dates per cik, any order. */
  events: Map<number, string[]>;
  shortInterest?: Map<number, DeskShortInterest>;
  /** Form 4 rows per cik (any period); the snapshot keeps the 90 days up to the session. */
  insiderRows?: Map<number, InsiderTradeRow[]>;
  inputs: Omit<DeskSnapshotInputs, "companiesWithoutPrices" | "priceSeries" | "latestPriceDate">;
}

export function buildDeskSnapshot(input: DeskBuildInput): DeskSnapshot {
  const priced = input.companies.filter((company) => (input.closes.get(company.cik)?.length ?? 0) > 0);
  const calendar = input.benchmark?.closes.map((point) => point.date) ?? [...new Set(priced.flatMap((company) => input.closes.get(company.cik)!.map((point) => point.date)))];
  const resolved = resolveSession(priced.map((company) => input.closes.get(company.cik)!.at(-1)!.date), calendar);
  if (!resolved) throw new Error("No stored closes: the desk snapshot needs at least one price series");
  const { session, previousSession } = resolved;
  const fullYear = new Set<string>();
  const companies: DeskCompany[] = [];
  for (const company of priced) {
    const series = input.closes.get(company.cik)!;
    const metrics = seriesMetrics(series, session, previousSession)!;
    if (metrics.fullYear) fullYear.add(company.ticker);
    const fundamentals = input.fundamentals.get(normalizeTicker(company.ticker)) ?? null;
    const history = [...(input.events.get(company.cik) ?? [])].filter((date) => date <= session).sort();
    const candidates = [history.at(-1) ?? null, fundamentals?.lastEarnings && fundamentals.lastEarnings <= session ? fundamentals.lastEarnings : null].filter((date): date is string => !!date);
    const lastEarnings = candidates.length ? candidates.sort().at(-1)! : null;
    const reaction = lastEarnings ? earningsReaction(series, lastEarnings) : null;
    const next = projectNextEarnings(history, lastEarnings, session);
    const drift = lastEarnings && metrics.lastDate === session ? earningsDrift(series, lastEarnings) : null;
    companies.push({
      ticker: company.ticker,
      registryTicker: company.registryTicker,
      cik: company.cik,
      name: company.name,
      sector: company.sector ?? "Other",
      industry: company.industry,
      research: company.research,
      close: metrics.close,
      lastDate: metrics.lastDate,
      returns: metrics.returns,
      high52: metrics.high52,
      low52: metrics.low52,
      ma50: metrics.ma50,
      ma200: metrics.ma200,
      vol20: metrics.vol20,
      marketCap: fundamentals?.marketCap ?? null,
      pe: fundamentals?.pe ?? null,
      beta: fundamentals?.beta ?? null,
      dividendYield: fundamentals?.dividendYield ?? null,
      epsTtm: fundamentals?.epsTtm ?? null,
      lastEarnings,
      lastEarningsReaction: reaction?.reaction ?? null,
      lastEarningsReactionSessions: reaction?.sessions ?? null,
      nextEarnings: next?.date ?? null,
      nextEarningsBasis: next?.basis ?? null,
      lastEarningsDrift: drift?.drift ?? null,
      lastEarningsDriftSessions: drift?.sessions ?? null,
      momentum12m1: metrics.lastDate === session ? momentum12m1(series, session) : null,
      shortInterest: input.shortInterest?.get(company.cik) ?? null,
      insiders: insiderSummary(input.insiderRows?.get(company.cik) ?? [], addDays(session, -90)),
      options: input.options.get(normalizeTicker(company.ticker)) ?? null,
      spark: metrics.spark,
    });
  }
  companies.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.ticker.localeCompare(b.ticker));
  const benchmarkMetrics = input.benchmark ? seriesMetrics(input.benchmark.closes, session, previousSession) : null;
  const latestPriceDate = priced.reduce((latest, company) => {
    const date = input.closes.get(company.cik)!.at(-1)!.date;
    return date > latest ? date : latest;
  }, "");
  return {
    schemaVersion: DESK_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    codeVersion: input.codeVersion,
    session,
    previousSession,
    inputs: {
      ...input.inputs,
      priceSeries: priced.length,
      latestPriceDate: latestPriceDate || null,
      companiesWithoutPrices: input.companies.filter((company) => !priced.includes(company)).map((company) => company.ticker).sort(),
    },
    benchmark: input.benchmark && benchmarkMetrics
      ? { ticker: input.benchmark.ticker, close: benchmarkMetrics.close, lastDate: benchmarkMetrics.lastDate, returns: benchmarkMetrics.returns, spark: benchmarkMetrics.spark }
      : null,
    breadth: computeBreadth(companies, fullYear),
    sectors: computeSectors(companies),
    companies,
  };
}
