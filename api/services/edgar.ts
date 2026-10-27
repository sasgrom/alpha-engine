/**
 * Rate-limited SEC EDGAR client (TypeScript port of the Python stage-1 client).
 * Same fair-access discipline: declared User-Agent, <= 8 req/s, backoff retries.
 */
import { parseWikiTables, projectColumns } from "./wikitable";
import { GICS_SP500 } from "./gics-snapshot";
import { cachedExternal } from "./ext-cache";

// 3l (D27): slow-moving external payloads persist in the DB cache
// (external_cache) with stale-while-revalidate — a cold process no longer
// makes the first user pay external latency. The in-process maps below stay
// as L1 on top of the DB cache.
const DIRECTORY_TTL_MS = 24 * 3600_000; // SEC company directory: daily cadence is plenty
const INDEX_TTL_MS = 72 * 3600_000;     // index constituents change a few times a year

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";

const USER_AGENT =
  process.env.SEC_USER_AGENT || "AlphaEngine Research contact@example.com";
const RPS = Number(process.env.SEC_RPS || "8");
const MAX_RETRIES = 5;
const BACKOFF_BASE = 1.5;

class RateLimiter {
  private minInterval: number;
  private nextAllowed = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(rps: number) {
    this.minInterval = 1000 / Math.max(rps, 0.1);
  }

  wait(): Promise<void> {
    const run = this.chain.then(async () => {
      const now = Date.now();
      const delay = this.nextAllowed - now;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      this.nextAllowed = Math.max(Date.now(), this.nextAllowed) + this.minInterval;
    });
    this.chain = run.catch(() => {});
    return run;
  }
}

const limiter = new RateLimiter(RPS);

async function secGet(url: string): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await limiter.wait();
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate" },
        signal: AbortSignal.timeout(60_000),
      });
      if (resp.status === 200) return resp;
      if ([429, 500, 502, 503, 504].includes(resp.status)) {
        await sleep(BACKOFF_BASE ** attempt * 1000);
        continue;
      }
      throw new Error(`HTTP ${resp.status} for ${url}`);
    } catch (err) {
      lastErr = err;
      await sleep(BACKOFF_BASE ** attempt * 1000);
    }
  }
  throw new Error(`GET ${url} failed after ${MAX_RETRIES} attempts: ${lastErr}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getJson<T = any>(url: string): Promise<T> {
  const resp = await secGet(url);
  return (await resp.json()) as T;
}

/**
 * Public rate-limited fetch for raw SEC content (documents, etc.).
 * Goes through the same token bucket + retry policy as every SEC call —
 * the only sanctioned way to touch SEC hosts from this codebase.
 */
export async function secFetch(url: string): Promise<Response> {
  return secGet(url);
}

// ---------------------------------------------------------------------------
// Ticker map
// ---------------------------------------------------------------------------
export interface TickerMapRow {
  cik: number;
  ticker: string;
  name: string;
}

let tickerMapCache: TickerMapRow[] | null = null;

async function tickerMapLive(): Promise<TickerMapRow[]> {
  const raw = await getJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    `${SEC_BASE}/files/company_tickers.json`
  );
  const rows = Object.values(raw).map((r) => ({
    cik: r.cik_str,
    ticker: r.ticker.toUpperCase(),
    name: r.title,
  }));
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.ticker) ? false : (seen.add(r.ticker), true)));
}

export async function tickerMap(refresh = false): Promise<TickerMapRow[]> {
  if (tickerMapCache && !refresh) return tickerMapCache;
  // DB-backed (D27): the 12k-row SEC directory is fetched once and served
  // from external_cache for 24 h; stale rows are served instantly while a
  // background refresh runs
  const r = await cachedExternal("sec-directory", DIRECTORY_TTL_MS, tickerMapLive);
  tickerMapCache = r.data;
  return tickerMapCache;
}

export async function cikForTicker(ticker: string): Promise<TickerMapRow | null> {
  const map = await tickerMap();
  return map.find((r) => r.ticker === ticker.toUpperCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Submissions / filing index
// ---------------------------------------------------------------------------
export interface FilingIndexRow {
  cik: number;
  accessionNo: string;
  form: string;
  filingDate: string | null;
  reportDate: string | null;
  primaryDoc: string | null;
  /** 8-K item list ("2.02,9.01"); empty string when the form carries none */
  items: string | null;
}

export async function submissions(cik: number): Promise<any> {
  return getJson(`${SEC_DATA_BASE}/submissions/CIK${String(cik).padStart(10, "0")}.json`);
}

export async function filingIndex(cik: number, forms: string[]): Promise<FilingIndexRow[]> {
  const payload = await submissions(cik);
  const recent = payload?.filings?.recent;
  if (!recent?.accessionNumber) return [];
  const out: FilingIndexRow[] = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    if (!forms.includes(form)) continue;
    out.push({
      cik,
      accessionNo: recent.accessionNumber[i],
      form,
      filingDate: recent.filingDate?.[i] ?? null,
      reportDate: recent.reportDate?.[i] ?? null,
      primaryDoc: recent.primaryDocument?.[i] ?? null,
      items: recent.items?.[i] || null, // 4a: 8-K item list feeds the events stream
    });
  }
  return out;
}

/**
 * Item list of one filing (4a): the Atom feed does not carry items, so
 * stream-caught 8-Ks resolve theirs here via the submissions payload.
 * Returns null when the accession is not in the recent window.
 */
export async function itemsForFiling(cik: number, accessionNo: string, prefetched?: any): Promise<string | null> {
  const payload = prefetched ?? (await submissions(cik));
  const recent = payload?.filings?.recent;
  if (!recent?.accessionNumber) return null;
  const i = recent.accessionNumber.indexOf(accessionNo);
  return i >= 0 ? recent.items?.[i] || null : null;
}

// ---------------------------------------------------------------------------
// XBRL company facts
// ---------------------------------------------------------------------------
export interface FactRow {
  cik: number;
  taxonomy: string;
  concept: string;
  unit: string;
  startDate: string | null;
  endDate: string | null;
  val: number | null;
  fy: number | null;
  fp: string | null;
  form: string | null;
  filed: string | null;
  accn: string | null;
}

export async function companyFacts(cik: number): Promise<any> {
  return getJson(`${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
}

export function factsToRows(payload: any): FactRow[] {
  const rows: FactRow[] = [];
  const cik = Number(payload?.cik);
  if (!Number.isInteger(cik) || cik <= 0) return rows;
  for (const [taxonomy, concepts] of Object.entries<any>(payload?.facts ?? {})) {
    for (const [concept, body] of Object.entries<any>(concepts)) {
      for (const [unit, records] of Object.entries<any>(body?.units ?? {})) {
        for (const rec of records as any[]) {
          rows.push({
            cik,
            taxonomy,
            concept,
            unit,
            startDate: rec.start ?? null,
            endDate: rec.end ?? null,
            val: typeof rec.val === "number" ? rec.val : null,
            fy: rec.fy ?? null,
            fp: rec.fp ?? null,
            form: rec.form ?? null,
            filed: rec.filed ?? null,
            accn: rec.accn ?? null,
          });
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Atom feed (near-real-time stream)
// ---------------------------------------------------------------------------
export interface FeedEntry {
  cik: number;
  accessionNo: string;
  form: string;
  filingDate: string | null;
  filingHref: string;
}

export async function recentFilingsFeed(cik: number, form?: string, count = 10): Promise<FeedEntry[]> {
  const params = new URLSearchParams({
    action: "getcompany",
    CIK: String(cik).padStart(10, "0"),
    dateb: "",
    owner: "include",
    count: String(count),
    output: "atom",
  });
  if (form) params.set("type", form);
  const resp = await secGet(`${SEC_BASE}/cgi-bin/browse-edgar?${params}`);
  const xml = await resp.text();
  const entries: FeedEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
      return r ? r[1].trim() : null;
    };
    const href = pick("filing-href") ?? "";
    const accessionNo = href.replace(/\/$/, "").split("/").pop() ?? "";
    if (!accessionNo) continue;
    entries.push({
      cik,
      accessionNo,
      form: pick("filing-type") ?? "",
      filingDate: pick("filing-date"),
      filingHref: href,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Filing document URL helpers (cloud phase: proxy on demand, no persistence)
// ---------------------------------------------------------------------------
export function filingIndexUrl(cik: number, accessionNo: string): string {
  return `${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/index.json`;
}

export function filingDocUrl(cik: number, accessionNo: string, doc: string): string {
  return `${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/${doc}`;
}

export async function fetchFilingDocument(cik: number, accessionNo: string, primaryDoc?: string | null) {
  const idx = await getJson<any>(filingIndexUrl(cik, accessionNo));
  let doc = primaryDoc ?? undefined;
  if (!doc) {
    const items: any[] = idx?.directory?.item ?? [];
    doc = items.find((i) => /\.(htm|txt)$/i.test(i.name) && !i.name.startsWith("index"))?.name;
  }
  if (!doc) throw new Error(`No document found for ${accessionNo}`);
  const resp = await secGet(filingDocUrl(cik, accessionNo, doc));
  return { docName: doc, html: await resp.text() };
}

// ---------------------------------------------------------------------------
// Index constituents (Wikipedia, cached in memory per process)
// ---------------------------------------------------------------------------
// Three index lists feed the scope selector (Universe + Jobs pages):
//   sp500 — full GICS Sector/Sub-Industry + CIK (drives companies.sector/
//           industry enrichment; the ONLY classification source we import,
//           see schema.ts comment on companies.sector)
//   ndx   — NASDAQ-100 tickers (ICB taxonomy ignored: incompatible with GICS)
//   dow   — Dow Jones 30 tickers
// Parsing is header-driven (services/wikitable.ts) because the three tables
// put the ticker in different columns and Wikipedia markup evolves.
// ---------------------------------------------------------------------------

/** One constituent row, normalized across the three index sources. */
export interface IndexConstituent {
  /** SEC-style ticker: uppercase, dots replaced by dashes (BRK.B -> BRK-B) */
  ticker: string;
  name: string | null;
  /** GICS Sector (sp500) / ICB Industry (ndx) / Sector (dow) — null if absent */
  sector: string | null;
  /** GICS Sub-Industry — only the S&P 500 table carries it */
  industry: string | null;
  /** CIK as a number — only the S&P 500 table carries it */
  cik: number | null;
}

type IndexKind = "sp500" | "ndx" | "dow";

/** Per-index source description: URL, optional table id, column matchers. */
const INDEX_SOURCES: Record<
  IndexKind,
  {
    url: string;
    tableId?: string;
    columns: Record<"ticker" | "name" | "sector" | "industry" | "cik", RegExp>;
  }
> = {
  sp500: {
    url: "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    tableId: "constituents",
    columns: {
      ticker: /^symbol$/i,
      name: /^security$/i,
      sector: /^gics\s+sector$/i,
      industry: /^gics\s+sub-?industry$/i,
      cik: /^cik$/i,
    },
  },
  ndx: {
    url: "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies",
    // no stable id on this page -> first flat wikitable wins
    columns: {
      ticker: /^ticker$/i,
      name: /^company$/i,
      sector: /^icb\s+industry/i,
      industry: /^icb\s+subsector/i,
      cik: /$^/, // never matches: the NDX table has no CIK column
    },
  },
  dow: {
    url: "https://en.wikipedia.org/wiki/List_of_Dow_Jones_Industrial_Average_companies",
    columns: {
      ticker: /^symbol$/i,
      name: /^company$/i,
      sector: /^sector$/i,
      industry: /$^/,
      cik: /$^/,
    },
  },
};

const constituentsCache: Partial<Record<IndexKind, IndexConstituent[]>> = {};

/** Ticker sanity check + SEC normalization (BRK.B -> BRK-B). */
function normalizeTicker(raw: string): string | null {
  const t = raw.toUpperCase().replace(/\./g, "-");
  return /^[A-Z][A-Z-]{0,9}$/.test(t) ? t : null;
}

async function indexConstituentsLive(kind: IndexKind): Promise<IndexConstituent[]> {
  const cached = constituentsCache[kind];
  if (cached) return cached;
  const src = INDEX_SOURCES[kind];
  const resp = await fetch(src.url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Wikipedia ${kind} HTTP ${resp.status}`);
  const html = await resp.text();
  const tables = parseWikiTables(html, src.tableId);
  // without an id filter (ndx/dow) take the first table that has a ticker
  // column — this guards against navigation tables at the top of the page
  const table =
    tables.find((t) => t.headers.some((h) => src.columns.ticker.test(h))) ??
    null;
  if (!table) throw new Error(`Wikipedia ${kind}: constituents table not found`);
  const out: IndexConstituent[] = [];
  for (const rec of projectColumns(table, src.columns)) {
    const ticker = rec.ticker ? normalizeTicker(rec.ticker) : null;
    if (!ticker) continue; // skip rows without a valid ticker (totals, footnotes)
    const cikNum = rec.cik ? Number(rec.cik.replace(/\D/g, "")) : NaN;
    out.push({
      ticker,
      name: rec.name,
      sector: rec.sector,
      industry: rec.industry,
      cik: Number.isFinite(cikNum) && cikNum > 0 ? cikNum : null,
    });
  }
  constituentsCache[kind] = out;
  return out;
}

/**
 * Public entry point for index constituents.
 * For the S&P 500, when Wikipedia is unreachable we serve the static GICS
 * snapshot (decision D14): the index changes 2–5 times a year, so a list
 * that is a couple of months stale beats the whole Universe page failing.
 * There is no snapshot for NDX/Dow — the error still propagates there and
 * the caller shows "n/a".
 */
export async function indexConstituents(kind: IndexKind): Promise<IndexConstituent[]> {
  try {
    // DB-backed (D27): Wikipedia lists persist in external_cache for 72 h;
    // the L1 in-process cache inside indexConstituentsLive is unchanged
    const r = await cachedExternal(`idx-${kind}`, INDEX_TTL_MS, () => indexConstituentsLive(kind));
    return r.data;
  } catch (e) {
    if (kind !== "sp500") throw e;
    const fromSnapshot: IndexConstituent[] = GICS_SP500.map((g) => ({
      ticker: g.ticker,
      name: null, // names come from SEC company_tickers.json — not needed from the snapshot
      sector: g.sector,
      industry: g.industry,
      cik: g.cik,
    }));
    constituentsCache[kind] = fromSnapshot;
    return fromSnapshot;
  }
}

/** Backward-compatible ticker-only view (used by resolveTickers / sp500Preview). */
export async function sp500Constituents(): Promise<string[]> {
  return (await indexConstituents("sp500")).map((c) => c.ticker).sort();
}
export async function ndxConstituents(): Promise<string[]> {
  return (await indexConstituents("ndx")).map((c) => c.ticker).sort();
}
export async function dowConstituents(): Promise<string[]> {
  return (await indexConstituents("dow")).map((c) => c.ticker).sort();
}
