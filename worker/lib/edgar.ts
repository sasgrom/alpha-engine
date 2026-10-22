/**
 * SEC EDGAR client + text extraction for the home worker (5b).
 *
 * Standalone (no api/ imports — the worker must run without the server tree):
 * secGet/submissions/docUrl are a minimal port of api/services/edgar.ts, and
 * derivePlaintext is a verbatim port of api/services/documents.ts (reproducible
 * pipeline rule). The MD&A extractor is a SIMPLIFIED port of
 * api/services/sections.ts (TOC-aware "last non-TOC heading wins", SIGNATURES
 * truncation) covering only what scoring needs: item7_mda (10-K),
 * p1_item2_mda (10-Q), body (8-K). TECH DEBT: unify with the server parser in
 * the shared/-contracts refactor iteration.
 *
 * Fair access: declared User-Agent, ~3 req/s serialized, retryable 429/5xx.
 * Amendments (10-K/A etc.) are skipped in v1.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";
const UA = "alpha-engine-research/1.0 (contact: owner@alphadelta-2.kimi.pro)";
const RPS = 3;

// --- tiny serialized rate limiter (same shape as the server's) -------------
let nextAllowed = 0;
let chain: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const run = chain.then(async () => {
    const delay = nextAllowed - Date.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    nextAllowed = Math.max(Date.now(), nextAllowed) + 1000 / RPS;
  });
  chain = run.catch(() => {});
  return run;
}

/** GET with fair-access pacing; 429/5xx retried with backoff, other 4xx fatal. */
export async function secGet(url: string, timeoutMs = 60_000): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept-encoding": "gzip, deflate" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw new Error(`GET ${url} failed after retries: ${lastErr}`);
}

// --- universe ---------------------------------------------------------------
export interface EdgarCompany { cik: number; ticker: string; name: string }

export function loadEdgarUniverse(): EdgarCompany[] {
  const file = path.resolve(import.meta.dirname, "..", "edgar-universe.json");
  return (JSON.parse(readFileSync(file, "utf8")) as EdgarCompany[]).filter((r) => r.cik && r.ticker);
}

// --- submissions API ----------------------------------------------------------
export interface EdgarFiling {
  accessionNo: string;   // "0000320193-24-000123"
  form: string;          // 10-K | 10-Q | 8-K (amendments filtered out)
  filingDate: string;    // YYYY-MM-DD
  primaryDoc: string;    // "aapl-20240928.htm"
  /** "YYYY-MM-DD HH:MM:SS" UTC from acceptanceDateTime; filingDate 00:00:00 fallback */
  eventTs: string;
}

export const EDGAR_FORMS = new Set(["10-K", "10-Q", "8-K"]);

function acceptanceToTs(raw: string | undefined, filingDate: string): string {
  // acceptanceDateTime comes as "20240101235959" (ET wall clock, no zone) —
  // we store it verbatim as eventTs (documented: ET, not UTC, pre-2000s data
  // is inconsistent anyway; the no-lookahead anchor is ingestedAt, not this).
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return `${filingDate} 00:00:00`;
}

function rowsFromBlock(block: any): EdgarFiling[] {
  const n = block?.accessionNumber?.length ?? 0;
  const out: EdgarFiling[] = [];
  for (let i = 0; i < n; i++) {
    const form = String(block.form?.[i] ?? "");
    if (!EDGAR_FORMS.has(form)) continue; // amendments end in "/A" — excluded
    const filingDate = String(block.filingDate?.[i] ?? "");
    out.push({
      accessionNo: String(block.accessionNumber[i]),
      form,
      filingDate,
      primaryDoc: String(block.primaryDocument?.[i] ?? ""),
      eventTs: acceptanceToTs(block.acceptanceDateTime?.[i], filingDate),
    });
  }
  return out;
}

/** Full filing history for a CIK: recent block + every archived files[] page. */
export async function listFilings(cik: number): Promise<EdgarFiling[]> {
  const padded = String(cik).padStart(10, "0");
  const sub = await (await secGet(`${SEC_DATA_BASE}/submissions/CIK${padded}.json`)).json() as any;
  const all = rowsFromBlock(sub?.filings?.recent);
  for (const f of sub?.filings?.files ?? []) {
    const page = await (await secGet(`${SEC_DATA_BASE}/submissions/${f.name}`)).json() as any;
    all.push(...rowsFromBlock(page));
  }
  // dedupe by accession (recent overlaps first archive page on busy filers)
  const seen = new Set<string>();
  return all.filter((r) => (seen.has(r.accessionNo) ? false : (seen.add(r.accessionNo), true)));
}

// --- document fetch -----------------------------------------------------------
export function filingDocUrl(cik: number, accessionNo: string, doc: string): string {
  return `${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/${doc}`;
}

/** Resolve + download the primary document; falls back to first .htm/.txt in the index. */
export async function fetchFilingDocument(cik: number, f: EdgarFiling): Promise<{ docName: string; html: string }> {
  let doc = f.primaryDoc;
  if (!doc) {
    const idx = await (await secGet(`${SEC_BASE}/Archives/edgar/data/${cik}/${f.accessionNo.replace(/-/g, "")}/index.json`)).json() as any;
    const items: any[] = idx?.directory?.item ?? [];
    doc = items.find((i) => /\.(htm|txt)$/i.test(i.name) && !/^index/i.test(i.name))?.name;
  }
  if (!doc) throw new Error(`no document for ${f.accessionNo}`);
  const res = await secGet(filingDocUrl(cik, f.accessionNo, doc));
  return { docName: doc, html: await res.text() };
}

// --- plaintext (verbatim port of api/services/documents.ts derivePlaintext) ----
export function derivePlaintext(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|table|h[1-6]|li|br|hr)[^>]*>/gi, "\n");
  s = s.replace(/<br[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”", reg: "®", trade: "™", copy: "©", sect: "§",
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

// --- section extraction (simplified port of api/services/sections.ts) ---------
/** TOC lines look like "Item 7. Management's Discussion ..... 42" — dot leaders or a bare page number. */
function isTocLine(line: string): boolean {
  return /\.{4,}\s*\d*\s*$/.test(line) || /\s\d{1,3}\s*$/.test(line);
}

/**
 * Line-start offset of a heading, skipping TOC occurrences; last non-TOC wins
 * (the body always follows the TOC). Regexes are anchored at line start so
 * prose mentions ("as discussed in Item 3.") never match.
 */
function findHeading(text: string, re: RegExp): number | null {
  const lines = text.split("\n");
  let offset = 0;
  let last: number | null = null;
  let fallback: number | null = null;
  for (const line of lines) {
    if (re.test(line)) {
      if (isTocLine(line)) fallback ??= offset;
      else last = offset;
    }
    offset += line.length + 1;
  }
  return last ?? fallback;
}

/**
 * The text a scorer should read for a filing:
 *  10-K → Item 7 (MD&A) .. Item 7A/8; 10-Q → Part I Item 2 (MD&A) .. Item 3;
 *  8-K  → whole body. Everything truncated at SIGNATURES.
 * Returns null when no section anchor is found (caller falls back to body head).
 */
export function extractScorableText(plain: string, form: string): string {
  const sigIdx = plain.search(/^\s*SIGNATURES?\s*$/im);
  const body = sigIdx > 0 ? plain.slice(0, sigIdx) : plain;
  if (form === "8-K") return body;
  const startRe = form === "10-K" ? /^\s*item\s+7[\.\:\s]/i : /^\s*item\s+2[\.\:\s]/i;
  const endRe = form === "10-K" ? /^\s*item\s+(7a|8)[\.\:\s]/i : /^\s*item\s+3[\.\:\s]/i;
  const start = findHeading(body, startRe);
  if (start == null) return body.slice(0, 12_000); // anchor miss: honest fallback, head of doc
  const lineEnd = body.indexOf("\n", start);
  const afterHeading = lineEnd > -1 ? body.slice(lineEnd + 1) : body.slice(start);
  const endRel = findHeading(afterHeading, endRe);
  const section = endRel != null ? afterHeading.slice(0, endRel) : afterHeading;
  return section.trim();
}

/**
 * 5c: whole-section scoring — with NUM_CTX at 32K the model reads the ENTIRE
 * section in one pass; windows remain only as the guard for texts longer
 * than the prompt cap (rare: >100K chars), evenly spaced as before.
 */
export function mdaWindows(text: string, windowSize = 100_000, max = 3): string[] {
  if (text.length <= windowSize) return [text];
  const count = Math.min(max, Math.ceil(text.length / windowSize));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.round((i * (text.length - windowSize)) / Math.max(count - 1, 1));
    out.push(text.slice(start, start + windowSize));
  }
  return out;
}
