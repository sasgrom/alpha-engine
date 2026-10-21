/**
 * Stage 2.2 — Cloud scoring prototype (platform LLM via the AI SDK).
 *
 * Purpose of iteration 3a: CALIBRATION of the rubric and prompt on 3–5
 * documents before launching the expensive local pipeline (Qwen2.5-14B on a
 * 4070 Ti). Model-agnostic by contract: llmVersion = "cloud:<modelId>" here,
 * "local:qwen2.5-14b-instruct-q5:llama.cpp" for the future worker — rows of
 * different sentiment_scores versions coexist (A/B comparability).
 *
 * Billing discipline (LLM calls are billed to the owner):
 *  - idempotency BEFORE the call: a section with a full score set under the
 *    same (llmVersion, promptVersion) is skipped without touching the model;
 *  - AiTransient -> exactly ONE retry with backoff (a double charge on retry
 *    is possible — logged); terminal errors -> fail without retry;
 *  - usageTokens is written to every row — spend is auditable in Sentiment Lab.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import { companies, documents, documentSections, filings, sentimentScores } from "@db/schema";
import { kimiGw } from "../../ai/provider";
import { listModels, classifyAiError, AiTransient } from "../../ai-client";
import { ASPECTS, type Aspect } from "./contract";
import { buildScoringPrompt, PROMPT_VERSION } from "./rubric";
import { readDocumentText } from "../sections";

// ---------------------------------------------------------------------------
// Zod result schema for generateObject (structured outputs).
// Structural validity (types/ranges) is enforced by the gateway via
// json_schema; the SEMANTIC check (evidence as a source substring) is ours,
// below.
// ---------------------------------------------------------------------------
const aspectScoreZ = z.object({
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(320),
});

export const scoreResultZ = z.object({
  aspects: z.object({
    outlook: aspectScoreZ,
    demand: aspectScoreZ,
    margins: aspectScoreZ,
    liquidity: aspectScoreZ,
    capex: aspectScoreZ,
    capital_return: aspectScoreZ,
    legal_reg: aspectScoreZ,
    accounting: aspectScoreZ,
  }),
  tone_delta: aspectScoreZ.nullable(),
});
export type ScoreResultZ = z.infer<typeof scoreResultZ>;

/**
 * Section groups for scoring. v1: MD&A (pairwise, with tone_delta), Risk
 * Factors, Financial Statements/footnotes. 8-K items and DEF 14A blocks are
 * the Stage 4 event stream and are out of the cloud prototype's scope.
 */
export const SECTION_GROUPS: Record<string, string[]> = {
  mda: ["item7_mda", "p1_item2_mda"],
  risk: ["item1a_risk", "p2_item1a_risk"],
  fin: ["item8_financials", "p1_item1_financials"],
};

type LogFn = (level: "info" | "warn" | "error", message: string) => Promise<void>;

/** Quote substring check (same normalization as contract.ts). */
export function evidenceVerified(evidence: string, sourceText: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(sourceText).includes(norm(evidence));
}

/** Base form without the amendment suffix: "10-K/A" pairs with "10-K". */
const baseForm = (f: string) => f.replace(/\/A$/, "");

/**
 * Pairwise prior selection (3h fix — like-with-like): the nearest OLDER MD&A
 * of the SAME base form (10-K ↔ 10-K, 10-Q ↔ 10-Q). Previously any older
 * MD&A paired up, so an annual report's tone was compared against a
 * quarterly update — different framing, contaminated tone_delta. Returns
 * null when no same-form prior exists (the section is then scored
 * non-pairwise, honestly). Input timeline is filingDate-DESC. Pure —
 * unit-tested.
 */
export function pickPriorSameForm<T extends { docId: number; form: string; filingDate: string | null }>(
  timelineDesc: T[],
  current: { docId: number; form: string; filingDate: string | null }
): T | null {
  return (
    timelineDesc.find(
      (p) =>
        p.docId !== current.docId &&
        baseForm(p.form) === baseForm(current.form) &&
        (p.filingDate ?? "") < (current.filingDate ?? "")
    ) ?? null
  );
}

/** Current cloud model (NOT hard-coded — the platform owns the list). */
export async function currentLlmVersion(): Promise<{ modelId: string; llmVersion: string }> {
  const { defaultModelId } = await listModels();
  return { modelId: defaultModelId, llmVersion: `cloud:${defaultModelId}` };
}

/**
 * Score one section of one document: idempotency check -> prompt ->
 * generateObject -> evidence verification -> versioned rows into the DB.
 * Returns stats for the job log; a terminal error is thrown upward (the
 * runner logs per-company and continues).
 */
export async function scoreSection(opts: {
  doc: typeof documents.$inferSelect;
  section: typeof documentSections.$inferSelect;
  priorText: string | null;
  modelId: string;
  llmVersion: string;
  log: LogFn;
}): Promise<{ status: "scored" | "skipped" | "failed"; tokens: number; evidenceRate: number | null }> {
  const { doc, section, priorText, modelId, llmVersion, log } = opts;
  const db = getDb();
  const pairwise = priorText !== null;

  // 1. idempotency: a full set = 8 aspects (+ tone_delta in pairwise mode)
  const expected = ASPECTS.length + (pairwise ? 1 : 0);
  const existing = await db
    .select({ id: sentimentScores.id })
    .from(sentimentScores)
    .where(
      and(
        eq(sentimentScores.documentId, doc.id),
        eq(sentimentScores.sectionKey, section.sectionKey),
        eq(sentimentScores.llmVersion, llmVersion),
        eq(sentimentScores.promptVersion, PROMPT_VERSION)
      )
    );
  if (existing.length >= expected) {
    return { status: "skipped", tokens: 0, evidenceRate: null };
  }

  // 2. section text + prompt (deterministic, pinned by PROMPT_VERSION)
  const text = await readDocumentText(doc);
  if (text === null) {
    await log("warn", `no text for doc ${doc.id}, skipped`);
    return { status: "failed", tokens: 0, evidenceRate: null };
  }
  const sectionText = text.slice(section.charStart, section.charEnd);
  const prompt = buildScoringPrompt({
    form: doc.form,
    sectionKey: section.sectionKey,
    text: sectionText,
    priorText,
  });

  // 3. model call; exactly one retry on AiTransient (429/5xx) with a 2s backoff
  let result: ScoreResultZ | null = null;
  let tokens: number | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await generateObject({
        model: kimiGw()(modelId),
        schema: scoreResultZ,
        prompt,
        // temperature is NOT set: the gateway model only accepts temp=1
        // (verified by a live call on 2026-10-10, HTTP 400 otherwise). Strict
        // reproducibility (temp=0 + fixed seed) is a property of the LOCAL
        // worker (llama.cpp); the cloud prototype is for rubric calibration.
      });
      result = r.object;
      tokens = (r.usage as { totalTokens?: number } | undefined)?.totalTokens ?? null;
      break;
    } catch (err) {
      const classified = classifyAiError(err);
      if (classified instanceof AiTransient && attempt === 1) {
        await log("warn", `LLM transient error (retry once, double billing possible): ${classified.message}`);
        await new Promise((r2) => setTimeout(r2, 2000));
        continue;
      }
      await log("error", `LLM scoring failed for ${doc.accessionNo}/${section.sectionKey}: ${classified.name}: ${classified.message}`);
      return { status: "failed", tokens: 0, evidenceRate: null };
    }
  }
  if (!result) return { status: "failed", tokens: 0, evidenceRate: null };

  // 4. evidence verification + versioned insert (NEVER overwrite)
  const rows: (typeof sentimentScores.$inferInsert)[] = [];
  let verified = 0;
  let total = 0;
  const pushRow = (aspect: string, s: z.infer<typeof aspectScoreZ>) => {
    const ok = evidenceVerified(s.evidence, sectionText);
    if (ok) verified++;
    total++;
    rows.push({
      cik: doc.cik,
      accessionNo: doc.accessionNo,
      form: doc.form,
      documentId: doc.id,
      sectionId: section.id,
      sectionKey: section.sectionKey,
      aspect,
      score: s.score,
      confidence: s.confidence,
      evidence: s.evidence,
      evidenceOk: ok,
      pairwise,
      llmVersion,
      promptVersion: PROMPT_VERSION,
      usageTokens: tokens,
    });
  };
  for (const a of ASPECTS) pushRow(a, result.aspects[a as Aspect]);
  if (pairwise && result.tone_delta) pushRow("tone_delta", result.tone_delta);

  // uq_score_idem guards against races; onDuplicateKeyUpdate is a no-op for clarity
  await db
    .insert(sentimentScores)
    .values(rows)
    .onDuplicateKeyUpdate({ set: { scoredAt: new Date() } });

  const evidenceRate = total > 0 ? verified / total : null;
  await log(
    evidenceRate !== null && evidenceRate < 1 ? "warn" : "info",
    `scored ${doc.form} ${doc.accessionNo}/${section.sectionKey}: ${rows.length} rows, evidence ${verified}/${total} verbatim, ${tokens ?? "?"} tokens`
  );
  return { status: "scored", tokens: tokens ?? 0, evidenceRate };
}

/**
 * Score all target sections of a company (the latest maxDocs documents
 * with sections). Pairwise mode: for each MD&A the PRIOR filing's MD&A of
 * the same company is pulled in (nearest by filingDate going back).
 */
export async function scoreCompany(
  cik: number,
  ticker: string,
  opts: { maxDocs: number; groups: string[]; pairwise: boolean; modelId: string; llmVersion: string },
  log: LogFn
): Promise<{ scored: number; skipped: number; failed: number; tokens: number }> {
  const db = getDb();
  const targetKeys = opts.groups.flatMap((g) => SECTION_GROUPS[g] ?? []);

  // the company's sections by filingDate desc (newest documents first)
  const rows = await db
    .select({
      section: documentSections,
      doc: documents,
      filingDate: filings.filingDate,
    })
    .from(documentSections)
    .innerJoin(documents, eq(documentSections.documentId, documents.id))
    .innerJoin(
      filings,
      and(eq(filings.cik, documentSections.cik), eq(filings.accessionNo, documentSections.accessionNo))
    )
    .where(and(eq(documentSections.cik, cik), inArray(documentSections.sectionKey, targetKeys)))
    .orderBy(desc(filings.filingDate))
    .limit(200);

  // group by document, keep the maxDocs freshest
  const byDoc = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byDoc.get(r.doc.id) ?? [];
    arr.push(r);
    byDoc.set(r.doc.id, arr);
  }
  const docIds = [...byDoc.keys()].slice(0, opts.maxDocs);

  // for pairwise mode: the company's MD&A sections by date desc (current/prior)
  const mdaKeys = SECTION_GROUPS.mda;
  const mdaTimeline = rows.filter((r) => mdaKeys.includes(r.section.sectionKey));

  let scored = 0, skipped = 0, failed = 0, tokens = 0;
  for (const docId of docIds) {
    const docRows = byDoc.get(docId)!;
    for (const r of docRows) {
      // prior MD&A: nearest OLDER MD&A of the SAME base form (3h, like-with-like)
      let priorText: string | null = null;
      if (opts.pairwise && mdaKeys.includes(r.section.sectionKey)) {
        const prior = pickPriorSameForm(
          mdaTimeline.map((p) => ({ docId: p.doc.id, form: p.doc.form, filingDate: p.filingDate, row: p })),
          { docId: r.doc.id, form: r.doc.form, filingDate: r.filingDate }
        );
        if (prior) {
          // prior is the wrapper { docId, form, filingDate, row } — the
          // section/document live on .row. (Pre-4h this read prior.doc /
          // prior.section — undefined at runtime, so priorText silently fell
          // to null and pairwise quietly degraded to non-pairwise. tsc found
          // it once type-checking was enforced; keep tsc in the loop.)
          const full = await readDocumentText(prior.row.doc);
          priorText = full ? full.slice(prior.row.section.charStart, prior.row.section.charEnd) : null;
        }
      }
      const res = await scoreSection({
        doc: r.doc,
        section: r.section,
        priorText,
        modelId: opts.modelId,
        llmVersion: opts.llmVersion,
        log,
      });
      if (res.status === "scored") scored++;
      else if (res.status === "skipped") skipped++;
      else failed++;
      tokens += res.tokens;
    }
  }
  await log("info", `${ticker}: scored=${scored} skipped=${skipped} failed=${failed}, ${tokens} tokens`);
  return { scored, skipped, failed, tokens };
}

/** ticker→cik via the companies table (scoring is offline, no SEC calls). */
export async function companiesForTickers(tickers: string[]): Promise<{ ticker: string; cik: number }[]> {
  if (tickers.length === 0) return [];
  return getDb()
    .select({ ticker: companies.ticker, cik: companies.cik })
    .from(companies)
    .where(inArray(companies.ticker, tickers));
}
