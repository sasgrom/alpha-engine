/**
 * Stage 2.1 — Section parser: cuts primary documents into semantic
 * sections (MD&A, Risk Factors, footnotes, 8-K items, DEF 14A blocks).
 *
 * Why regex/heuristics and not an LLM: sectioning is a mechanical task with
 * a deterministic answer; an LLM is expensive and non-deterministic. Every
 * ambiguity is flagged (confidence flags), never silently guessed — those
 * flags are filter inputs at the scoring stage.
 *
 * Key problems of real filings and how they are solved:
 *  1. TABLE OF CONTENTS (TOC): every "Item 7." occurs twice — in the TOC and
 *     in the body. TOC lines are detected by dot leaders ("..... 42") or a
 *     bare page number at line end; among non-TOC occurrences the LAST one
 *     wins (the body always follows the TOC). If every occurrence is
 *     TOC-like, the last one is taken with a "toc_fallback" flag.
 *  2. A 10-Q has TWO parts with colliding numbering (Item 1 in Part I =
 *     financial statements, Item 1 in Part II = legal proceedings) — section
 *     keys are part-aware: p1_item2_mda / p2_item1a_risk. If no Part heading
 *     is found, a heading-keyword fallback applies + a part_unknown flag.
 *  3. A heading can span two lines ("Item 7.
Management's...") — a lone
 *     label line is glued to the next non-empty one.
 *  4. The last 10-K/10-Q section is truncated at the SIGNATURES line so
 *     signatures and the exhibit index never leak into section text.
 *
 * The module is deliberately split: parseSections() is a pure function
 * (text, form) => hits (unit-tested on synthetic fixtures), extract* is the
 * DB/storage glue.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, documents, documentSections } from "@db/schema";
import { storage } from "../lib/storage";

/** Bump = rebuild all sections (old rows stay under their own version). */
export const SECTION_PARSER_VERSION = 1;

/** One located section: the half-open interval [charStart, charEnd) in plaintext. */
export interface SectionHit {
  sectionKey: string;
  title: string;
  charStart: number;
  charEnd: number;
  flags: string[];
}

/** Document parse result: sections + document-level flags (for the job log). */
export interface SectionParseResult {
  sections: SectionHit[];
  docFlags: string[];
}

// ---------------------------------------------------------------------------
// Section catalogs by form
// ---------------------------------------------------------------------------

/** 10-K: item numbers are globally unique, no part prefix needed. */
const ITEM_KEYS_10K: Record<string, string> = {
  "1": "item1_business",
  "1a": "item1a_risk",
  "1b": "item1b_unresolved",
  "1c": "item1c_cybersecurity",
  "2": "item2_properties",
  "3": "item3_legal",
  "4": "item4_mine_safety",
  "5": "item5_market",
  "6": "item6_selected",
  "7": "item7_mda",
  "7a": "item7a_market_risk",
  "8": "item8_financials",
  "9": "item9_accountants",
  "9a": "item9a_controls",
  "9b": "item9b_other",
  "9c": "item9c_foreign",
  "10": "item10_directors",
  "11": "item11_exec_comp",
  "12": "item12_ownership",
  "13": "item13_relationships",
  "14": "item14_accountant_fees",
  "15": "item15_exhibits",
  "16": "item16_summary",
};

/** 10-Q Part I: the financial part. */
const ITEM_KEYS_10Q_P1: Record<string, string> = {
  "1": "p1_item1_financials",
  "2": "p1_item2_mda",
  "3": "p1_item3_market_risk",
  "4": "p1_item4_controls",
};

/** 10-Q Part II: legal/misc part (item numbers collide with Part I!). */
const ITEM_KEYS_10Q_P2: Record<string, string> = {
  "1": "p2_item1_legal",
  "1a": "p2_item1a_risk",
  "2": "p2_item2_unregistered_sales",
  "3": "p2_item3_defaults",
  "4": "p2_item4_mine_safety",
  "5": "p2_item5_other",
  "6": "p2_item6_exhibits",
};

/**
 * Fallback for a 10-Q without a resolved Part context: classify by heading
 * keywords. Conservative: on no match the section gets a generic key and a
 * part_unknown flag.
 */
const TITLE_FALLBACK_10Q: { re: RegExp; key: string }[] = [
  { re: /discussion and analysis/i, key: "p1_item2_mda" },
  { re: /risk factors/i, key: "p2_item1a_risk" },
  { re: /legal proceedings/i, key: "p2_item1_legal" },
  { re: /financial statements/i, key: "p1_item1_financials" },
  { re: /controls and procedures/i, key: "p1_item4_controls" },
  { re: /market risk/i, key: "p1_item3_market_risk" },
  { re: /exhibits/i, key: "p2_item6_exhibits" },
];

/**
 * DEF 14A has no item structure — we look for named blocks.
 * The list covers what actually goes into scoring (compensation narrative,
 * pay-vs-performance, governance); proposal headings are deliberately not
 * cut: too short and noisy to be standalone sections.
 */
const DEF14A_BLOCKS: { key: string; re: RegExp }[] = [
  { key: "def14a_cdna", re: /^compensation discussion and analysis\b/i },
  { key: "def14a_exec_comp", re: /^executive compensation\b/i },
  { key: "def14a_pay_vs_perf", re: /^pay versus performance\b/i },
  { key: "def14a_audit_report", re: /^report of the (audit|independent)/i },
  { key: "def14a_governance", re: /^(corporate )?governance\b/i },
  { key: "def14a_ownership", re: /^security ownership\b/i },
];

/** Core sections whose absence is a job-log signal (not stored in the DB). */
const CORE_SECTIONS: Record<string, string> = {
  "10-K": "item7_mda",
  "10-Q": "p1_item2_mda",
  "DEF 14A": "def14a_cdna",
};

/** A section shorter than this threshold is suspicious (parse almost certainly failed). */
const SHORT_SECTION_CHARS = 300;

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

interface LineIndex {
  lines: string[];
  /** offsets[i] = char offset where the i-th line starts in the source text */
  offsets: number[];
}

/** Split into lines preserving offsets (the DB stores offsets). */
function indexLines(text: string): LineIndex {
  const lines: string[] = [];
  const offsets: number[] = [];
  // walk \n manually so offsets stay exact (split() loses them)
  let i = 0;
  while (i <= text.length) {
    const nl = text.indexOf("\n", i);
    if (nl === -1) {
      lines.push(text.slice(i));
      offsets.push(i);
      break;
    }
    lines.push(text.slice(i, nl));
    offsets.push(i);
    i = nl + 1; // the line index always advances — an infinite loop is impossible
  }
  return { lines, offsets };
}

/** Item heading: "Item 7.", "ITEM 1A.", "Item 2.02 ...". */
const ITEM_RE = /^item\s+(\d{1,2})([a-z])?(?:\s*\.\s*(\d{2}))?\b[.:]?\s*(.*)$/i;
/** Part heading: "Part II", "PART III." */
const PART_RE = /^part\s+(iv|iii|ii|i)\b/i;
/** End of the report body. */
const SIGNATURES_RE = /^signatures\b/i;

/** TOC markers: dot leaders or a bare page number at line end. */
function looksLikeToc(line: string): boolean {
  if (/(\.{3,}|…)\s*\d{1,4}\s*$/.test(line)) return true; // "Item 7. MD&A ..... 42"
  // a bare trailing number = page; a year ("…December 31, 2024") is excluded by a threshold
  const tail = line.match(/\s(\d{1,4})$/);
  return !!tail && Number(tail[1]) <= 400;
}

interface Heading {
  /** index of the heading line */
  lineIdx: number;
  offset: number;
  /** normalized label: "7" | "1a" | "2.02" */
  label: string;
  /** Part number (1..4) in effect at the heading */
  part: number | null;
  title: string;
  tocLike: boolean;
}

/** Collect all item-heading candidates with their Part context. */
function collectItemHeadings(idx: LineIndex): Heading[] {
  const heads: Heading[] = [];
  let part: number | null = null;
  for (let i = 0; i < idx.lines.length; i++) {
    const line = idx.lines[i].trim();
    const pm = PART_RE.exec(line);
    if (pm) {
      part = { i: 1, ii: 2, iii: 3, iv: 4 }[pm[1].toLowerCase()] ?? null;
      continue;
    }
    const m = ITEM_RE.exec(line);
    if (!m) continue;
    // label: "2.02" (8-K style) | "1a" (letter) | "7" (bare number)
    const label = m[3] ? `${m[1]}.${m[3]}` : (m[1] + (m[2] ?? "")).toLowerCase();
    let title = line;
    // glue a two-line heading: "Item 7." + "Management's Discussion…"
    if (!m[4] && i + 1 < idx.lines.length) {
      const next = idx.lines[i + 1].trim();
      if (next && !ITEM_RE.test(next) && !PART_RE.test(next)) title = `${line} ${next}`;
    }
    heads.push({
      lineIdx: i,
      offset: idx.offsets[i] + (idx.lines[i].length - idx.lines[i].trimStart().length),
      label,
      part,
      title: title.slice(0, 250),
      tocLike: looksLikeToc(line),
    });
  }
  return heads;
}

/**
 * Additional TOC detector for tables of contents WITHOUT page numbers.
 * Real case (AAPL 10-K 2025): TOC entries like "Item 7." (the page number
 * sits on the adjacent line) arrive in a dense series of ~2-4 lines each.
 * Cluster = >= 3 item headings inside a 12-line window, entirely within the
 * first 10% of the document's LINES. Guards against false positives:
 *  - threshold 3 + window 12: adjacent items in short 8-Ks are not a cluster;
 *  - the early zone is measured in LINES, not chars (in compact texts a char%
 *    rule flagged legitimate body headings — a bug caught by the 10-Q test);
 *  - a cluster overlapping the body start degrades into toc_fallback (the
 *    section is still extracted, but flagged) instead of data loss.
 */
function markTocClusters(heads: Heading[], totalLines: number): void {
  const earlyLine = totalLines * 0.1;
  for (const h of heads) {
    if (h.tocLike || h.lineIdx > earlyLine) continue;
    const window = heads.filter(
      (o) => o.lineIdx >= h.lineIdx && o.lineIdx <= h.lineIdx + 12 && o.lineIdx <= earlyLine
    );
    if (window.length >= 3) window.forEach((o) => (o.tocLike = true));
  }
}

/**
 * Body-occurrence selection, two-phase:
 *  1. by label (ignoring Part): if ALL occurrences are TOC-like, take the
 *     last one with a toc_fallback flag (the TOC beats nothing);
 *  2. otherwise TOC-like occurrences are dropped and the rest are grouped by
 *     (part, label) — otherwise Item 1 of Part I and Part II of a 10-Q would
 *     eat each other (a real bug caught by the "Item 1 in Part I and Part
 *     II" test).
 * Duplicates inside one (part, label) group get the toc_ambiguous flag.
 */
function selectBodyHeadings(heads: Heading[]): { chosen: Heading[]; dupLabels: string[]; fallbackLabels: string[] } {
  const byLabel = new Map<string, Heading[]>();
  for (const h of heads) {
    const arr = byLabel.get(h.label) ?? [];
    arr.push(h);
    byLabel.set(h.label, arr);
  }
  const survivors: Heading[] = [];
  const fallbackLabels: string[] = [];
  for (const [label, arr] of byLabel) {
    const body = arr.filter((h) => !h.tocLike);
    if (body.length === 0) {
      survivors.push(arr[arr.length - 1]);
      fallbackLabels.push(label);
    } else {
      survivors.push(...body);
    }
  }
  // phase 2: (part, label) — inside a group the LAST occurrence wins
  const byPartLabel = new Map<string, Heading[]>();
  for (const h of survivors) {
    const k = `${h.part ?? 0}|${h.label}`;
    const arr = byPartLabel.get(k) ?? [];
    arr.push(h);
    byPartLabel.set(k, arr);
  }
  const chosen: Heading[] = [];
  const dupLabels: string[] = [];
  for (const [k, arr] of byPartLabel) {
    if (arr.length > 1) dupLabels.push(k);
    chosen.push(arr[arr.length - 1]);
  }
  return { chosen: chosen.sort((a, b) => a.offset - b.offset), dupLabels, fallbackLabels };
}

/** Map a label to its canonical sectionKey by form and Part context. */
function keyFor(h: Heading, formBase: string): { key: string; flags: string[] } {
  const flags: string[] = [];
  if (formBase === "10-K") {
    return { key: ITEM_KEYS_10K[h.label] ?? `item${h.label.replace(".", "_")}`, flags };
  }
  if (formBase === "10-Q") {
    if (h.part === 1 && ITEM_KEYS_10Q_P1[h.label]) return { key: ITEM_KEYS_10Q_P1[h.label], flags };
    if (h.part === 2 && ITEM_KEYS_10Q_P2[h.label]) return { key: ITEM_KEYS_10Q_P2[h.label], flags };
    // Part unknown or number not in the catalog — heading-keyword fallback
    for (const f of TITLE_FALLBACK_10Q) {
      if (f.re.test(h.title)) {
        flags.push("part_unknown");
        return { key: f.key, flags };
      }
    }
    flags.push("part_unknown");
    return { key: `p${h.part ?? 0}_item${h.label.replace(".", "_")}`, flags };
  }
  if (formBase === "8-K") {
    // "2.02" -> 8k_2_02; a bare number (rare in old 8-Ks) -> 8k_<n>
    return { key: `8k_${h.label.replace(".", "_")}`, flags };
  }
  return { key: `item${h.label.replace(".", "_")}`, flags };
}

/**
 * The main pure function: (plaintext, form) -> sections with offsets.
 * form arrives as the base form ("10-K", "10-Q", "8-K", "DEF 14A");
 * amendments ("/A") are handled as their base form — same structure.
 */
export function parseSections(text: string, form: string): SectionParseResult {
  const formBase = form.replace(/\/A$/, "").trim();
  const idx = indexLines(text);

  // --- DEF 14A: named blocks instead of an item structure -----------------
  if (formBase === "DEF 14A") {
    const hits: SectionHit[] = [];
    for (let i = 0; i < idx.lines.length; i++) {
      const line = idx.lines[i].trim();
      if (looksLikeToc(line)) continue; // DEF 14A has a table of contents too
      for (const b of DEF14A_BLOCKS) {
        if (b.re.test(line) && !hits.some((h) => h.sectionKey === b.key)) {
          hits.push({ sectionKey: b.key, title: line.slice(0, 250), charStart: idx.offsets[i], charEnd: -1, flags: [] });
          break;
        }
      }
    }
    hits.sort((a, b) => a.charStart - b.charStart);
    for (let i = 0; i < hits.length; i++) {
      hits[i].charEnd = i + 1 < hits.length ? hits[i + 1].charStart : text.length;
      if (hits[i].charEnd - hits[i].charStart < SHORT_SECTION_CHARS) hits[i].flags.push("short_section");
    }
    const docFlags: string[] = [];
    if (!hits.some((h) => h.sectionKey === CORE_SECTIONS["DEF 14A"])) docFlags.push("missing:def14a_cdna");
    return { sections: hits, docFlags };
  }

  // --- item-structured forms (10-K / 10-Q / 8-K) --------------------------
  const heads = collectItemHeadings(idx);
  markTocClusters(heads, idx.lines.length); // TOCs without page numbers
  // (4h) fallbackLabels is intentionally not destructured: the flag pass
  // below already marks every tocLike chosen heading "toc_fallback", so the
  // list carried no additional signal (an unused-variable tsc error since 3a).
  const { chosen, dupLabels } = selectBodyHeadings(heads);

  // SIGNATURES position for truncating the last body section;
  // TOC lines like "Signatures ...... 95" are skipped by the same marker
  let signaturesOffset = -1;
  for (let i = 0; i < idx.lines.length; i++) {
    const line = idx.lines[i].trim();
    if (SIGNATURES_RE.test(line) && !looksLikeToc(line)) {
      signaturesOffset = idx.offsets[i];
      break;
    }
  }

  // phase A: map to keys + flags (boundaries computed later)
  const mapped = chosen.map((h) => {
    const { key, flags } = keyFor(h, formBase);
    if (h.tocLike) flags.push("toc_fallback");
    // dupLabels holds the "part|label" keys from phase 2 of selectBodyHeadings
    if (dupLabels.includes(`${h.part ?? 0}|${h.label}`)) flags.push("toc_ambiguous");
    return { h, key, flags };
  });
  // dedupe by sectionKey: different (part,label) pairs can map to one key
  // (part_unknown fallback vs part-aware), and the uq_doc_section DB unique
  // index forgives no duplicates — keep the first occurrence in document order
  const seenKeys = new Set<string>();
  const kept = mapped.filter((m) => (seenKeys.has(m.key) ? false : (seenKeys.add(m.key), true)));

  // phase B: boundaries are computed ONLY from the surviving headings
  // (otherwise a dropped duplicate's text would "fall through" into the gap
  // between its neighbours)
  const hits: SectionHit[] = [];
  for (let i = 0; i < kept.length; i++) {
    const { h, key, flags } = kept[i];
    let charEnd = i + 1 < kept.length ? kept[i + 1].h.offset : text.length;
    // the last section is truncated at SIGNATURES (signatures/exhibit index are not needed)
    if (signaturesOffset > h.offset && signaturesOffset < charEnd) charEnd = signaturesOffset;
    if (charEnd - h.offset < SHORT_SECTION_CHARS) flags.push("short_section");
    hits.push({ sectionKey: key, title: h.title, charStart: h.offset, charEnd, flags });
  }

  const docFlags: string[] = [];
  const core = CORE_SECTIONS[formBase];
  if (core && !hits.some((h) => h.sectionKey === core)) docFlags.push(`missing:${core}`);
  if (formBase === "8-K" && hits.length === 0) docFlags.push("no_items_found");
  return { sections: hits, docFlags };
}

// ---------------------------------------------------------------------------
// DB/storage glue (invoked by the "sections" job from runner.ts)
// ---------------------------------------------------------------------------

/** Read a document's derived plaintext from object storage. */
export async function readDocumentText(doc: { textKey: string | null }): Promise<string | null> {
  if (!doc.textKey) return null;
  const bytes = await storage.readFile({ fileKey: doc.textKey });
  return Buffer.from(bytes).toString("utf-8");
}

/** Text of one section (sliced by offsets) — the scoring input. */
export async function sectionText(doc: { textKey: string | null }, section: { charStart: number; charEnd: number }): Promise<string | null> {
  const text = await readDocumentText(doc);
  return text === null ? null : text.slice(section.charStart, section.charEnd);
}

type LogFn = (level: "info" | "warn" | "error", message: string) => Promise<void>;

/**
 * Parse sections of all of a company's primary documents.
 * Idempotent per parser version: DELETE by (documentId, parserVersion),
 * then INSERT fresh rows (in chunks of <= 500 — the hosted MySQL limit).
 * Exhibits are NOT sectioned: they have no item structure; for scoring they
 * will go as whole texts bound to their filing by accessionNo.
 */
export async function parseCompanySections(
  cik: number,
  ticker: string,
  log: LogFn
): Promise<{ docs: number; sections: number }> {
  const db = getDb();
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.cik, cik), eq(documents.fetchStatus, "fetched"), eq(documents.role, "primary")));
  let totalSections = 0;
  for (const doc of docs) {
    const text = await readDocumentText(doc);
    if (text === null) {
      await log("warn", `${ticker} ${doc.accessionNo}: no derived text, skipped`);
      continue;
    }
    const { sections, docFlags } = parseSections(text, doc.form);
    // rebuild at the current parser version
    await db
      .delete(documentSections)
      .where(and(eq(documentSections.documentId, doc.id), eq(documentSections.parserVersion, SECTION_PARSER_VERSION)));
    if (sections.length > 0) {
      const rows = sections.map((s) => ({
        documentId: doc.id,
        cik: doc.cik,
        accessionNo: doc.accessionNo,
        form: doc.form,
        sectionKey: s.sectionKey,
        title: s.title,
        charStart: s.charStart,
        charEnd: s.charEnd,
        flags: s.flags.length > 0 ? JSON.stringify(s.flags) : null,
        parserVersion: SECTION_PARSER_VERSION,
      }));
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(documentSections).values(rows.slice(i, i + CHUNK));
      }
    }
    totalSections += sections.length;
    const flagInfo = [
      ...docFlags,
      ...sections.flatMap((s) => s.flags.map((f) => `${s.sectionKey}:${f}`)),
    ];
    await log(
      docFlags.length > 0 ? "warn" : "info",
      `${ticker} ${doc.form} ${doc.accessionNo}: ${sections.length} sections${flagInfo.length ? " flags=" + flagInfo.join(",") : ""}`
    );
  }
  return { docs: docs.length, sections: totalSections };
}

/** cik list for tickers from the DB (no SEC calls — sections build offline). */
export async function ciksForTickers(tickers: string[]): Promise<{ ticker: string; cik: number }[]> {
  if (tickers.length === 0) return [];
  return getDb()
    .select({ ticker: companies.ticker, cik: companies.cik })
    .from(companies)
    .where(inArray(companies.ticker, tickers));
}
