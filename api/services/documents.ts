/**
 * Stage 1.5 — Document Registry service.
 *
 * Builds the machine-readable corpus that Stage 2 (local LLM) will consume:
 * every document of every in-scope filing (primary document + exhibits such as
 * EX-99.1 press releases) is registered in the `documents` table, downloaded
 * from SEC Archives, hash-verified, stored in object storage, and mechanically
 * derived into plaintext.
 *
 * Design contracts (see docs/ALPHA_ENGINE_MANUAL.md §4.2):
 *  - raw HTML is the immutable source of truth (SHA-256 anchored);
 *  - plaintext is a REGENERABLE derivative; bump PARSER_VERSION to re-derive;
 *  - the canonical document key layout `CIK{10}/{accession-nodash}/{filename}`
 *    is identical in cloud storage and the future local SEC mirror;
 *  - heavy work here is network-bound (SEC + storage review), not CPU — the
 *    cloud runner handles it; semantic work stays with the local LLM.
 */
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documents, filings } from "@db/schema";
import { storage } from "../lib/storage";
import * as edgar from "./edgar";

/** Bump when the HTML->text extraction logic changes; plaintext is then re-derivable. */
export const PARSER_VERSION = 1;

/** Form types whose documents enter the corpus (approved scope, iteration 2). */
export const DOCUMENT_FORM_SCOPE = [
  "10-K", "10-Q", "8-K",
  "10-K/A", "10-Q/A", "8-K/A",
  "DEF 14A",
] as const;

// ---------------------------------------------------------------------------
// Filing document enumeration
// ---------------------------------------------------------------------------

export interface FilingDocumentItem {
  name: string;
  type: string | null;
  sizeBytes: number | null;
}

/**
 * List all documents inside one submission via its SEC Archives index.json.
 * The index is the authoritative manifest: it includes the primary document,
 * all exhibits, graphics and XBRL viewer fragments (R*.htm).
 */
export async function fetchFilingDocumentList(
  cik: number,
  accessionNo: string
): Promise<FilingDocumentItem[]> {
  const idx = await edgar.getJson<any>(edgar.filingIndexUrl(cik, accessionNo));
  const items: any[] = idx?.directory?.item ?? [];
  return items
    .filter((i) => typeof i.name === "string")
    .map((i) => ({
      name: i.name as string,
      // index.json "type" is usually a mime-icon filename ("text.gif") — junk;
      // keep it only when it looks like a genuine SEC document type
      type: typeof i.type === "string" && !/\.(gif|jpg|png)$/i.test(i.type) ? i.type : null,
      sizeBytes: Number.isFinite(Number(i.size)) ? Number(i.size) : null,
    }));
}

/**
 * Whether a document belongs in the text corpus.
 * Excluded: graphics, stylesheets, XBRL instances/schemas (machine-only),
 * Excel renderings, SEC's auto-generated R*.htm viewer fragments (the
 * underlying numbers already live in the `facts` table), the index pages,
 * and the full-submission {accession}.txt — the latter duplicates every
 * other document concatenated and would double the storage bill.
 */
export function isTextualDocument(item: FilingDocumentItem, accessionNo?: string): boolean {
  const n = item.name.toLowerCase();
  if (!/\.(htm|html|txt)$/.test(n)) return false;
  if (/^r\d+\.htm$/.test(n)) return false; // XBRL viewer fragment
  if (/-index(-headers)?\.html?$/.test(n)) return false; // SEC index pages
  if (n === "financial_report.xlsx") return false;
  if (accessionNo && n === `${accessionNo.toLowerCase()}.txt`) return false; // full-submission dupe
  return true;
}

/**
 * Role classification. NOTE: index.json's `type` field carries mime-icon junk
 * ("text.gif"), not SEC document types — so exhibits are detected by the
 * filename conventions EDGAR actually uses ("exhibit21…", "…-ex991…", "ex-99.1").
 */
export function classifyRole(
  item: FilingDocumentItem,
  primaryDoc: string | null
): "primary" | "exhibit" | "other" {
  if (primaryDoc && item.name === primaryDoc) return "primary";
  if (/exhibit|(^|[^a-z])ex[-_]?\d/i.test(item.name)) return "exhibit";
  return "other";
}

// ---------------------------------------------------------------------------
// Plaintext derivation (deterministic, version 1)
// ---------------------------------------------------------------------------

/**
 * Mechanical HTML -> plaintext extraction. Deliberately dependency-free:
 * the pipeline must be reproducible by the future local worker (Python) with
 * identical semantics, so the algorithm stays simple and documented:
 *   1. drop <script>/<style>/<head> blocks;
 *   2. convert block-level tags to newlines (keep document's visual structure);
 *   3. strip remaining tags;
 *   4. decode the standard HTML entity set used by EDGAR filings;
 *   5. collapse horizontal whitespace, trim lines, collapse 3+ blank lines.
 */
export function derivePlaintext(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|table|h[1-6]|li|br|hr)[^>]*>/gi, "\n");
  s = s.replace(/<br[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** HTML entities commonly found in EDGAR documents (named + numeric). */
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

// ---------------------------------------------------------------------------
// Harvest pipeline
// ---------------------------------------------------------------------------

/** Canonical storage key for a document (same layout as the local mirror). */
export function canonicalDocKey(cik: number, accessionNo: string, docName: string): string {
  return `CIK${String(cik).padStart(10, "0")}/${accessionNo.replace(/-/g, "")}/${docName}`;
}

type LogFn = (level: "info" | "warn" | "error", message: string) => Promise<void>;

/**
 * Register + fetch + store + derive one filing's documents.
 * Idempotent: existing `fetched` rows are skipped; `failed` rows are retried.
 * Returns counts for job progress reporting.
 */
export async function harvestFilingDocuments(
  cik: number,
  accessionNo: string,
  form: string,
  primaryDoc: string | null,
  log: LogFn
): Promise<{ fetched: number; failed: number; skipped: number }> {
  const db = getDb();
  const items = (await fetchFilingDocumentList(cik, accessionNo))
    .filter((i) => isTextualDocument(i, accessionNo));
  let fetched = 0, failed = 0, skipped = 0;

  for (const item of items) {
    const role = classifyRole(item, primaryDoc);
    // upsert registry row first (pending) — the registry is the source of truth
    await db
      .insert(documents)
      .values({
        cik, accessionNo, form,
        docName: item.name, docType: item.type, role,
        sizeBytes: item.sizeBytes,
      })
      .onDuplicateKeyUpdate({ set: { docType: item.type, role } });

    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.cik, cik), eq(documents.accessionNo, accessionNo), eq(documents.docName, item.name)))
      .limit(1);
    if (row.fetchStatus === "fetched") { skipped++; continue; }

    try {
      // 1. download raw bytes from SEC Archives
      const resp = await edgar.secFetch(edgar.filingDocUrl(cik, accessionNo, item.name));
      const raw = Buffer.from(await resp.arrayBuffer());
      const sha256 = createHash("sha256").update(raw).digest("hex");
      const docKey = canonicalDocKey(cik, accessionNo, item.name);

      // 2. store the immutable raw document
      const savedRaw = await storage.uploadFile({
        fileContent: new Uint8Array(raw),
        fileName: docKey,
        contentType: item.name.toLowerCase().endsWith(".txt") ? "text/plain" : "text/html",
      });

      // 3. derive plaintext (mechanical; re-derivable — see PARSER_VERSION)
      let textKey: string | null = null;
      let textLength: number | null = null;
      if (!item.name.toLowerCase().endsWith(".txt")) {
        const text = derivePlaintext(raw.toString("utf-8"));
        const savedText = await storage.uploadFile({
          fileContent: new TextEncoder().encode(text),
          fileName: docKey + ".txt",
          contentType: "text/plain",
        });
        textKey = savedText.key;
        textLength = text.length;
      } else {
        textKey = savedRaw.key; // .txt documents are their own plaintext
        textLength = raw.length;
      }

      await db
        .update(documents)
        .set({
          sha256, storageKey: savedRaw.key, textKey, textLength,
          parserVersion: PARSER_VERSION,
          location: "cloud", fetchStatus: "fetched", fetchedAt: new Date(),
          fetchError: null,
        })
        .where(eq(documents.id, row.id));
      fetched++;
    } catch (err) {
      failed++;
      const msg = String((err as Error)?.message ?? err).slice(0, 490);
      await db
        .update(documents)
        .set({ fetchStatus: "failed", fetchError: msg })
        .where(eq(documents.id, row.id));
      await log("warn", `doc failed ${accessionNo}/${item.name}: ${msg}`);
    }
  }
  return { fetched, failed, skipped };
}

/**
 * Harvest all in-scope filings of one company (bounded per form type to keep
 * the cloud test scope small; the local worker will run unbounded later).
 * Refreshes the filing index first so amendments / DEF 14A are included.
 */
export async function harvestCompanyDocuments(
  cik: number,
  ticker: string,
  forms: string[],
  maxFilingsPerForm: number,
  log: LogFn
): Promise<{ filings: number; docs: number }> {
  const db = getDb();
  // ensure the local filing index covers the document scope (e.g. DEF 14A was
  // absent from earlier bootstraps)
  const idx = await edgar.filingIndex(cik, [...DOCUMENT_FORM_SCOPE]);
  for (const f of idx) {
    await db
      .insert(filings)
      .values({
        cik: f.cik, accessionNo: f.accessionNo, form: f.form,
        // DEF 14A and some 8-K filings have an empty reportDate in the
        // submissions API — MySQL strict mode rejects '' for a date column,
        // so empty values are coerced to NULL
        filingDate: f.filingDate || null, reportDate: f.reportDate || null, primaryDoc: f.primaryDoc,
      })
      .onDuplicateKeyUpdate({ set: { primaryDoc: f.primaryDoc } });
  }

  // select the N most recent filings per form
  let totalDocs = 0, filingsDone = 0;
  for (const form of forms) {
    const rows = await db
      .select()
      .from(filings)
      .where(and(eq(filings.cik, cik), eq(filings.form, form)))
      .orderBy(filings.filingDate)
      .limit(100000);
    const recent = rows.sort((a, b) => (b.filingDate ?? "").localeCompare(a.filingDate ?? "")).slice(0, maxFilingsPerForm);
    for (const f of recent) {
      const r = await harvestFilingDocuments(cik, f.accessionNo, f.form, f.primaryDoc, log);
      totalDocs += r.fetched;
      filingsDone++;
      await log("info", `${ticker} ${form} ${f.filingDate}: +${r.fetched} docs (${r.failed} failed, ${r.skipped} existing)`);
    }
  }
  return { filings: filingsDone, docs: totalDocs };
}
