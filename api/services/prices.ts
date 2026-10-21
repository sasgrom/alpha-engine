/**
 * Stage 1.7 — Historical daily price bars from free providers.
 *
 * Provider abstraction (D22): two interchangeable fetchers behind one
 * interface, tried in priority order:
 *   1. stooq  — free CSV endpoint, no API key, lenient rate limits;
 *               daily bars are already split/dividend-adjusted (adjClose =
 *               close by construction — kept explicit for schema uniformity)
 *   2. yahoo  — unofficial v8 chart JSON (browser UA, conservative backoff);
 *               carries a separate adjclose series and volume on every bar
 *
 * Bars from different providers NEVER overwrite each other: `source` is part
 * of the unique key, so a Yahoo bar and a Stooq bar for the same day coexist
 * and can be reconciled later. Read paths pick one preferred source
 * (stooq first, then yahoo) via pickPreferredBars().
 *
 * Accumulation model (user directive, 3f): history is loaded once (backfill)
 * and then grown incrementally day by day. A sync is resumable — since 3h
 * each provider continues from ITS OWN MAX(date), so a rate-limited or
 * cancelled run loses nothing and a gap in one source is never masked by
 * the other's fresher bars.
 *
 * NOTE on Selenium: deliberately NOT used. Both providers are plain HTTP;
 * a browser-driven fallback can be added as a third provider without
 * touching the sync/read logic if Yahoo ever hard-blocks plain requests.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, prices, seriesPoints } from "@db/schema";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
export interface PriceBar {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

export type PriceSource = "stooq" | "yahoo";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry with exponential backoff; 429 gets an extra-long cooldown. */
async function fetchWithRetry(url: string, tries = 4): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
        redirect: "follow",
      });
      if (resp.ok) return resp;
      // 429 / 5xx are retriable; a hard 4xx (404 delisted etc.) is not
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(`HTTP ${resp.status}`);
        await sleep((resp.status === 429 ? 8000 : 1500) * attempt);
        continue;
      }
      throw new Error(`HTTP ${resp.status} (non-retriable)`);
    } catch (err) {
      lastErr = err;
      if (String(err).includes("non-retriable")) throw err;
      await sleep(1500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// provider: stooq (primary)
// CSV: Date,Open,High,Low,Close,Volume — daily, adjusted, no key required.
// https://stooq.com/q/d/l/?s=aapl.us&i=d&d1=20150101&d2=20250101
// ---------------------------------------------------------------------------
export function parseStooqCsv(text: string): PriceBar[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const bars: PriceBar[] = [];
  for (const line of lines.slice(1)) {
    const [date, o, h, l, c, v] = line.split(",");
    if (!date || !c || c === "null") continue; // stooq emits null rows for halted days
    const num = (s: string | undefined) => {
      const n = Number(s);
      return s === undefined || s === "null" || !Number.isFinite(n) ? null : n;
    };
    const close = num(c);
    bars.push({
      date,
      open: num(o),
      high: num(h),
      low: num(l),
      close,
      adjClose: close, // stooq daily series is already fully adjusted
      volume: num(v),
    });
  }
  return bars;
}

async function fetchStooq(ticker: string, from?: string, to?: string): Promise<PriceBar[]> {
  const sym = `${ticker.toLowerCase().replace(/\./g, "-")}.us`;
  let url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
  if (from) url += `&d1=${from.replaceAll("-", "")}`;
  if (to) url += `&d2=${to.replaceAll("-", "")}`;
  const resp = await fetchWithRetry(url);
  const text = await resp.text();
  if (text.includes("Exceeded the daily hits limit")) {
    throw new Error("stooq daily hits limit exceeded — resumable, try later");
  }
  return parseStooqCsv(text);
}

// ---------------------------------------------------------------------------
// provider: yahoo (fallback)
// Unofficial but stable v8 chart endpoint; plain JSON, no scraping.
// ---------------------------------------------------------------------------
interface YahooChartJson {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

export function parseYahooChart(json: YahooChartJson): PriceBar[] {
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: PriceBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q?.close?.[i] ?? null;
    if (close === null) continue; // halted / pre-IPO gap rows
    // timestamps are UTC seconds of the market session; toISOString date is
    // the trading day for US exchanges (16:00 ET close = 20:00-21:00 UTC)
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    bars.push({
      date,
      open: q?.open?.[i] ?? null,
      high: q?.high?.[i] ?? null,
      low: q?.low?.[i] ?? null,
      close,
      adjClose: adj[i] ?? close,
      volume: q?.volume?.[i] ?? null,
    });
  }
  return bars;
}

async function fetchYahoo(ticker: string, from?: string, to?: string): Promise<PriceBar[]> {
  const p1 = from ? Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000) : 0;
  const p2 = to ? Math.floor(new Date(to + "T23:59:59Z").getTime() / 1000) : Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const resp = await fetchWithRetry(url);
  const json = (await resp.json()) as YahooChartJson;
  if (json.chart?.error) {
    throw new Error(`yahoo chart error: ${json.chart.error.code ?? ""} ${json.chart.error.description ?? ""}`.trim());
  }
  return parseYahooChart(json);
}

/**
 * Provider fallback lives directly in syncCompanyPrices (3h): each provider
 * resumes from ITS OWN cursor, so the fallback decision and the incremental
 * cursor cannot be separated without re-introducing the mixed-source gap.
 * The fetchers stay module-private; tests pin the parsers instead.
 */

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------
/** Insert-or-update bars in <=500-row chunks (project DDL convention). */
export async function upsertBars(cik: number, ticker: string, bars: PriceBar[], source: PriceSource | "test") {
  const db = getDb();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < bars.length; i += CHUNK) {
    const slice = bars.slice(i, i + CHUNK).map((b) => ({
      cik,
      ticker,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      adjClose: b.adjClose,
      volume: b.volume,
      source,
    }));
    if (slice.length === 0) continue;
    await db
      .insert(prices)
      .values(slice)
      .onDuplicateKeyUpdate({
        set: {
          open: sql`VALUES(\`open\`)`,
          high: sql`VALUES(\`high\`)`,
          low: sql`VALUES(\`low\`)`,
          close: sql`VALUES(\`close\`)`,
          adjClose: sql`VALUES(\`adjClose\`)`,
          volume: sql`VALUES(\`volume\`)`,
          ticker: sql`VALUES(\`ticker\`)`,
          // lineage honesty: a re-import/re-sync refreshes the fetch stamp —
          // VALUES() of an omitted insert column yields its default (now)
          fetchedAt: sql`VALUES(\`fetchedAt\`)`,
        },
      });
    written += slice.length;
  }
  return written;
}

/**
 * Latest stored bar date — the incremental cursor. Per-source since 3h:
 * with one shared cursor, a newer Yahoo bar would mask a Stooq gap forever
 * (the two providers legitimately diverge). Without `source`, the cursor is
 * the max over real providers (test rows never count).
 */
export async function lastStoredDate(cik: number, source?: PriceSource): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ d: sql<string | null>`MAX(${prices.date})` })
    .from(prices)
    .where(source ? and(eq(prices.cik, cik), eq(prices.source, source)) : and(eq(prices.cik, cik), sql`${prices.source} <> 'test'`));
  return row?.d ?? null;
}

/**
 * Sync one company's daily bars. Incremental by construction: starts the day
 * after the newest stored bar; a company with no bars gets a full backfill.
 * Returns a small honest report for the job log.
 */
export async function syncCompanyPrices(
  cik: number,
  ticker: string,
  opts: { fullBackfill?: boolean } = {}
): Promise<{ bars: number; source: PriceSource | "none"; from: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  // per-source cursors (3h): each provider resumes from ITS OWN last bar, so
  // a mixed-source history can no longer strand a gap in the stooq series
  const lastStooq = opts.fullBackfill ? null : await lastStoredDate(cik, "stooq");
  const lastYahoo = opts.fullBackfill ? null : await lastStoredDate(cik, "yahoo");
  const cursor = lastStooq ?? lastYahoo; // the preferred source drives the skip check
  if (cursor && cursor >= today) return { bars: 0, source: "none", from: cursor }; // already current
  // overlap by one day on purpose: rewrites the possibly-partial last bar
  try {
    const bars = await fetchStooq(ticker, lastStooq ?? undefined, today);
    if (bars.length > 0) {
      const written = await upsertBars(cik, ticker, bars, "stooq");
      return { bars: written, source: "stooq", from: bars[0].date };
    }
    if (lastStooq) return { bars: 0, source: "stooq", from: lastStooq }; // incremental, nothing new
    // stooq empty on a FULL-history request = ticker unknown there — try yahoo
  } catch {
    /* stooq failed — yahoo fallback below */
  }
  const bars = await fetchYahoo(ticker, lastYahoo ?? undefined, today);
  if (bars.length === 0) return { bars: 0, source: "yahoo", from: lastYahoo };
  const written = await upsertBars(cik, ticker, bars, "yahoo");
  return { bars: written, source: "yahoo", from: bars[0].date };
}

/**
 * Companies of a resolved scope ordered stalest-first: never-synced (NULL
 * last date) come before the oldest-synced. This ordering is what makes a
 * re-run of the prices job resume the unfinished tail automatically.
 * Tickers not present in the companies table are silently dropped — price
 * sync only works for ingested companies (we key bars by cik).
 */
export async function companiesByStaleness(
  tickers: string[]
): Promise<{ cik: number; ticker: string; last: string | null }[]> {
  if (tickers.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      cik: companies.cik,
      ticker: companies.ticker,
      last: sql<string | null>`(SELECT MAX(p.date) FROM prices p WHERE p.cik = ${companies.cik} AND p.source <> 'test')`,
    })
    .from(companies)
    .where(inArray(companies.ticker, tickers.map((t) => t.toUpperCase())))
    .limit(2000);
  return rows.sort((a, b) => {
    if (a.last === null && b.last === null) return 0;
    if (a.last === null) return -1;
    if (b.last === null) return 1;
    return a.last < b.last ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// read path: one preferred series per company
// ---------------------------------------------------------------------------
export interface StoredBar extends PriceBar {
  source: string;
}

/**
 * Merge two source series into one (3h): union by date, the PRIMARY source
 * wins on conflicts. Previously getBars returned the primary source whenever
 * it had ANY row in range — a single stale stooq bar would hide a full
 * recent yahoo series. Extracted pure for unit tests.
 */
export function mergeBars(primary: StoredBar[], fallback: StoredBar[]): StoredBar[] {
  const byDate = new Map<string, StoredBar>();
  for (const b of fallback) byDate.set(b.date, b);
  for (const b of primary) byDate.set(b.date, b); // later write = priority
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Bars for a company, merged across sources (stooq preferred per date —
 * it is the more consistent of the two; yahoo fills dates stooq lacks).
 * `from`/`to` are inclusive ISO dates.
 */
export async function getBars(cik: number, from?: string, to?: string): Promise<StoredBar[]> {
  const db = getDb();
  const bySource = new Map<PriceSource, StoredBar[]>();
  for (const source of ["stooq", "yahoo"] as const) {
    const conds = [eq(prices.cik, cik), eq(prices.source, source)];
    if (from) conds.push(sql`${prices.date} >= ${from}`);
    if (to) conds.push(sql`${prices.date} <= ${to}`);
    const rows = await db
      .select()
      .from(prices)
      .where(and(...conds))
      .orderBy(prices.date)
      .limit(15000);
    if (rows.length > 0) {
      bySource.set(
        source,
        rows.map((r) => ({
          date: r.date,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          adjClose: r.adjClose,
          volume: r.volume,
          source: r.source,
        }))
      );
    }
  }
  const s = bySource.get("stooq");
  const y = bySource.get("yahoo");
  if (!s) return y ?? [];
  if (!y) return s;
  return mergeBars(s, y);
}

// ---------------------------------------------------------------------------
// derived statistics (all computed in-house from our own data — D22)
// ---------------------------------------------------------------------------
export function changePct(last: number, prev: number): number | null {
  if (!prev) return null;
  return (last - prev) / prev;
}

/**
 * Average daily volume over the last `days` calendar days of bars.
 * The window is anchored to the LAST STORED BAR, not to wall-clock now:
 * archive-imported history ages between syncs, and a today-anchored window
 * would silently shrink (then go null) as the data stales.
 */
export function avgVolume(bars: StoredBar[], days: number): number | null {
  if (bars.length === 0) return null;
  const anchor = bars[bars.length - 1].date; // bars arrive ascending by date
  const cutoff = new Date(Date.parse(anchor) - days * 86400_000).toISOString().slice(0, 10);
  const vols = bars.filter((b) => b.date >= cutoff && b.volume !== null).map((b) => b.volume as number);
  if (vols.length === 0) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

/**
 * 52-week high/low from bars (adjusted close is not used — raw extremes).
 * Same anchoring rule as avgVolume: the 52-week window ends at the LAST
 * STORED BAR so a stale-but-complete history still yields its true range.
 */
export function week52(bars: StoredBar[]): { high: number | null; low: number | null } {
  if (bars.length === 0) return { high: null, low: null };
  const anchor = bars[bars.length - 1].date;
  const cutoff = new Date(Date.parse(anchor) - 364 * 86400_000).toISOString().slice(0, 10);
  const win = bars.filter((b) => b.date >= cutoff);
  const highs = win.map((b) => b.high).filter((v): v is number => v !== null);
  const lows = win.map((b) => b.low).filter((v): v is number => v !== null);
  return {
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
  };
}

/**
 * Monthly-return beta vs a benchmark (SPY), the standard 5-year monthly
 * regression: beta = cov(r_asset, r_bench) / var(r_bench). Needs >= 24
 * overlapping month-ends; returns null when history is too short.
 */
export function beta5y(asset: StoredBar[], bench: StoredBar[]): number | null {
  const monthLast = (bars: StoredBar[]) => {
    const m = new Map<string, number>();
    for (const b of bars) {
      const c = b.adjClose ?? b.close;
      if (c !== null) m.set(b.date.slice(0, 7), c); // later dates overwrite → month-end
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  };
  const A = monthLast(asset);
  const B = new Map(monthLast(bench));
  const rets: [number, number][] = [];
  for (let i = 1; i < A.length; i++) {
    const [m0, p0] = A[i - 1];
    const [m1, p1] = A[i];
    const b0 = B.get(m0);
    const b1 = B.get(m1);
    if (b0 === undefined || b1 === undefined || !p0 || !b0) continue;
    rets.push([p1 / p0 - 1, b1 / b0 - 1]);
  }
  if (rets.length < 24) return null;
  const n = rets.length;
  const ma = rets.reduce((s, r) => s + r[0], 0) / n;
  const mb = rets.reduce((s, r) => s + r[1], 0) / n;
  let cov = 0;
  let vb = 0;
  for (const [ra, rb] of rets) {
    cov += (ra - ma) * (rb - mb);
    vb += (rb - mb) * (rb - mb);
  }
  if (vb === 0) return null;
  return cov / vb;
}

/**
 * Trailing-twelve-month EPS and P/E from our canonical series (Stage 1.6):
 * the last 4 quarterly diluted-EPS points in the latest vintage.
 * Shares outstanding for market cap: latest diluted-shares point.
 * Both are null when the series build has not run for the company — the UI
 * shows "—" rather than a fabricated number (billing/data honesty rule).
 */
export async function fundamentalsFromSeries(cik: number): Promise<{
  epsTtm: number | null;
  sharesDiluted: number | null;
}> {
  const db = getDb();
  const grab = async (concept: string) =>
    db
      .select({ periodEnd: seriesPoints.periodEnd, val: seriesPoints.val })
      .from(seriesPoints)
      .where(
        and(
          eq(seriesPoints.cik, cik),
          eq(seriesPoints.concept, concept),
          eq(seriesPoints.vintage, "latest")
        )
      )
      .orderBy(desc(seriesPoints.periodEnd))
      .limit(8);

  const eps = (await grab("EarningsPerShareDiluted")).filter((p) => p.val !== null).slice(0, 4);
  const epsTtm = eps.length === 4 ? eps.reduce((s, p) => s + (p.val as number), 0) : null;

  const sharesRows = await grab("WeightedAverageNumberOfDilutedSharesOutstanding");
  const sharesDiluted = sharesRows.find((p) => p.val !== null)?.val ?? null;
  return { epsTtm, sharesDiluted };
}
