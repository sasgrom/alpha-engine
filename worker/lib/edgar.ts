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

export interface FilingDocItem { name: string; size: number }

/** Documents of one filing from its index.json (name + byte size). */
export async function listFilingDocs(cik: number, accessionNo: string): Promise<FilingDocItem[]> {
  const idx = await (await secGet(`${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/index.json`)).json() as any;
  return (idx?.directory?.item ?? [])
    .map((i: any) => ({ name: String(i.name ?? ""), size: Number(String(i.size ?? "0").replace(/[^\d]/g, "")) || 0 }))
    .filter((d: FilingDocItem) => d.name);
}

/** Download one specific document of a filing. */
export async function fetchDoc(cik: number, accessionNo: string, doc: string): Promise<string> {
  return (await secGet(filingDocUrl(cik, accessionNo, doc))).text();
}

/**
 * Resolve + download the primary document. Old filings (pre-2005) often name
 * a primaryDoc that no longer exists in Archives ("0001.txt" → 404): on ANY
 * fetch failure of the named doc, fall back to the filing index and take the
 * largest textual document actually present.
 */
export async function fetchFilingDocument(cik: number, f: EdgarFiling): Promise<{ docName: string; html: string }> {
  if (f.primaryDoc) {
    try {
      const res = await secGet(filingDocUrl(cik, f.accessionNo, f.primaryDoc));
      return { docName: f.primaryDoc, html: await res.text() };
    } catch {
      // named doc missing/moved — rescue via the index below
    }
  }
  const docs = await listFilingDocs(cik, f.accessionNo);
  const doc = docs
    .filter((d) => /\.(htm|txt)$/i.test(d.name) && !/^index/i.test(d.name))
    .sort((a, b) => b.size - a.size)[0];
  if (!doc) throw new Error(`no document for ${f.accessionNo}`);
  return { docName: doc.name, html: await fetchDoc(cik, f.accessionNo, doc.name) };
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
/** TOC lines: dot leaders, a trailing page number, or a bare page-number line (nbsp tolerated). */
function isTocLine(line: string): boolean {
  const l = line.replace(/\u00a0/g, " ");
  return /\.{4,}\s*\d*\s*$/.test(l) || /\s\d{1,4}\s*$/.test(l) || /^\s*\d{1,4}\s*$/.test(l);
}

/** A bare label line: "Item 2." alone — the title lives on the NEXT line. */
const BARE_LABEL_RE = /^\s*item\s+\d+[a-z]?[\.\:]?\s*$/i;

/**
 * Line-start offset of a heading. TOC-vs-body resolution, proven against real
 * NVDA filings (10-Q accn …-26-000075, 10-K 2026-02-25):
 *  - TOC entries appear as a bare label ("Item 2.") with the title + page on
 *    the NEXT line (10-Q: "Management's Discussion… 25") or with the page as
 *    a standalone nbsp-line TWO lines down (10-K: "\u00a0 36");
 *  - a 10-Q has TWO body headings with the same number (Part I Item 2 = MD&A,
 *    Part II Item 2 = unregistered sales), so "last wins" is wrong — the body
 *    anchor is the FIRST non-TOC hit AFTER the last TOC hit.
 */
function findHeading(text: string, re: RegExp): number | null {
  const lines = text.split("\n");
  const hits: { offset: number; toc: boolean }[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) {
      let toc = isTocLine(line);
      if (!toc && BARE_LABEL_RE.test(line.replace(/\u00a0/g, " "))) {
        const next = lines.slice(i + 1).filter((l) => l.trim() !== "").slice(0, 3).map((l) => l.replace(/\u00a0/g, " "));
        if (
          next.length > 0 &&
          (/\s\d{1,4}\s*$/.test(next[0]) || /\.{4,}/.test(next[0]) || next.slice(0, 2).some((l) => /^\d{1,4}$/.test(l.trim())))
        ) {
          toc = true; // title+page (next line) or standalone page line (2 lines down) = TOC entry
        }
      }
      hits.push({ offset, toc });
    }
    offset += line.length + 1;
  }
  if (hits.length === 0) return null;
  const lastTocIdx = hits.reduce((acc, h, i) => (h.toc ? i : acc), -1);
  const body = hits.find((h, i) => !h.toc && i > lastTocIdx) ?? hits.find((h) => !h.toc);
  if (body) return body.offset;
  return hits[0].offset; // every occurrence TOC-like: take the first, honestly
}

/**
 * The text a scorer should read for a filing:
 *  10-K → Item 7 (MD&A) .. Item 7A/8; 10-Q → Part I Item 2 (MD&A) .. Item 3;
 *  8-K  → whole body. Everything truncated at SIGNATURES.
 * Returns null when no section anchor is found (caller falls back to body head).
 */
export function extractScorableText(plain: string, form: string): string {
  // The TOC has its own bare "Signatures" entry line — truncating at the
  // FIRST match cuts the document at the TOC. The real signature block is
  // the LAST occurrence.
  const sigMatches = [...plain.matchAll(/^\s*SIGNATURES?\s*$/gim)];
  const sigIdx = sigMatches.length > 0 ? sigMatches[sigMatches.length - 1].index! : -1;
  const body = sigIdx > 0 ? plain.slice(0, sigIdx) : plain;
  if (form === "8-K") {
    // 5c fix: the cover page + TABLE OF CONTENTS flooded the window and the
    // model rightly reported "only TOC entries" (score 0). Skip the TOC block
    // when present, then start at the first real Item heading; pre-2005
    // filings without Item headings fall back to the whole body.
    const toc = body.match(/^\s*table\s+of\s+contents\s*$/im);
    let rest = body;
    if (toc) {
      // skip the TOC heading AND its entry lines (dot leaders / page numbers)
      const lines = body.slice((toc.index ?? 0) + toc[0].length).split("\n");
      let i = 0;
      while (i < lines.length && (isTocLine(lines[i]) || lines[i].trim() === "")) i++;
      rest = lines.slice(i).join("\n");
    }
    const firstItem = rest.match(/^\s*item\s+\d/im);
    return (firstItem ? rest.slice(firstItem.index) : body).trim();
  }
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
 * 5c: deterministic substance gate — runs BEFORE the LLM, no tokens spent.
 * A cover page / TOC / XBRL header has no tone to score: scoring it produced
 * garbage like -1.00 for "only administrative metadata". Thin = very short
 * OR dominated by TOC-style lines (dot leaders / bare page numbers).
 */
export function isThinContent(text: string): boolean {
  if (text.length < 1200) return true;
  const lines = text.split("\n").filter((l) => l.trim()).slice(0, 80);
  if (lines.length === 0) return true;
  const tocish = lines.filter((l) => isTocLine(l)).length;
  return tocish / lines.length > 0.5;
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
