/**
 * Stage 2.2 — Semantic scoring contract (sentiment contract).
 *
 * This is the SINGLE source of truth about the score format, shared by:
 *  - the cloud prototype (platform LLM, iteration 3a);
 *  - the future local worker (Qwen2.5-14B + llama.cpp + a GBNF grammar
 *    generated from SCORE_JSON_SCHEMA — never edit it by hand);
 *  - the sentiment_scores table (DDL 003) — its columns mirror the contract.
 *
 * Key decisions (see docs/ALPHA_ENGINE_MANUAL.md, Decision Log D8+):
 *  - the scale is CONTINUOUS [-1, +1], not binary: FFT denoising and the
 *    Bayesian posterior in Stage 3/4 require a continuous signal;
 *  - every score carries confidence ∈ [0,1] (a weight in downstream
 *    analytics) and evidence — a VERBATIM quote from the text (machine-
 *    verified as a substring of the source — hallucination protection);
 *  - scores are VERSIONED (never overwritten): idempotency by the key
 *    (document, section, aspect, llm_version, prompt_version).
 */

// ---------------------------------------------------------------------------
// Taxonomy: 8 aspects + a pairwise tone delta
// ---------------------------------------------------------------------------
export const ASPECTS = [
  "outlook",        // forward-looking statements, guidance, management expectations
  "demand",         // demand, orders, backlog, revenue drivers
  "margins",        // margins, costs, pricing
  "liquidity",      // liquidity, debt, covenants, cash flow
  "capex",          // investment plans, capacity, R&D direction
  "capital_return", // dividends, buybacks, M&A capital allocation
  "legal_reg",      // litigation, regulatory risk, compliance
  "accounting",     // accounting quality: restatements, policy changes, audit
] as const;
export type Aspect = (typeof ASPECTS)[number];

/** One aspect score for one document section. */
export interface AspectScore {
  /** continuous score −1…+1 (0 = neutral / no signal) */
  score: number;
  /** model confidence 0…1 (NOT a probability — a heuristic weight) */
  confidence: number;
  /** verbatim quote from the section text (<= 300 chars) — machine-verified */
  evidence: string;
}

/** Full scoring result for one section (or a section pair for tone_delta). */
export interface SectionScoreResult {
  aspects: Record<Aspect, AspectScore>;
  /**
   * MD&A tone delta vs the PRIOR period (−1…+1).
   * Filled only in pairwise mode (both MD&A texts in one context);
   * null in single-period mode — never fabricate it.
   */
  tone_delta: AspectScore | null;
}

// ---------------------------------------------------------------------------
// JSON Schema — LLM response validation + the base of the llama.cpp GBNF grammar
// ---------------------------------------------------------------------------
const aspectScoreSchema = {
  type: "object",
  properties: {
    score: { type: "number", minimum: -1, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "string", maxLength: 300 },
  },
  required: ["score", "confidence", "evidence"],
  additionalProperties: false,
} as const;

export const SCORE_JSON_SCHEMA = {
  type: "object",
  properties: {
    aspects: {
      type: "object",
      properties: Object.fromEntries(ASPECTS.map((a) => [a, aspectScoreSchema])),
      required: [...ASPECTS],
      additionalProperties: false,
    },
    tone_delta: { anyOf: [aspectScoreSchema, { type: "null" }] },
  },
  required: ["aspects", "tone_delta"],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Result validation (applied before any DB write)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  aspect: string;
  problem: string;
}

/**
 * Whitespace normalization for the quote check: an LLM may wrap lines
 * differently from the plaintext — collapse whitespace on both sides.
 * Semantically the quote must remain a VERBATIM substring.
 */
function normalizeForEvidence(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Strict model-response validation. Any problem = refusal to write
 * (logged in the job log), NOT a silent repair: half-hallucinated scores are
 * worse than missing ones, because Stage 3/4 compute signals from them.
 */
export function validateScoreResult(
  raw: unknown,
  sourceText: string,
  opts: { expectToneDelta: boolean }
): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const push = (aspect: string, problem: string) => issues.push({ aspect, problem });

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, issues: [{ aspect: "*", problem: "result is not an object" }] };
  }
  const r = raw as Record<string, unknown>;
  const aspects = r.aspects as Record<string, unknown> | undefined;
  if (typeof aspects !== "object" || aspects === null) {
    return { ok: false, issues: [{ aspect: "*", problem: "missing aspects object" }] };
  }

  const checkScore = (aspect: string, v: unknown) => {
    if (typeof v !== "object" || v === null) return push(aspect, "missing score object");
    const s = v as Record<string, unknown>;
    if (typeof s.score !== "number" || s.score < -1 || s.score > 1) push(aspect, "score out of [-1,1]");
    if (typeof s.confidence !== "number" || s.confidence < 0 || s.confidence > 1) push(aspect, "confidence out of [0,1]");
    if (typeof s.evidence !== "string" || s.evidence.length === 0) {
      push(aspect, "evidence empty");
    } else if (s.evidence.length > 300) {
      push(aspect, "evidence >300 chars");
    } else if (!normalizeForEvidence(sourceText).includes(normalizeForEvidence(s.evidence))) {
      // the main anti-hallucination check: the quote must exist in the source
      push(aspect, "evidence not found in source (hallucination?)");
    }
  };

  for (const a of ASPECTS) checkScore(a, aspects[a]);

  // tone_delta: required in pairwise mode, must be null in single-period mode
  if (opts.expectToneDelta) {
    if (r.tone_delta === null || r.tone_delta === undefined) push("tone_delta", "missing in pairwise mode");
    else checkScore("tone_delta", r.tone_delta);
  } else if (r.tone_delta !== null) {
    push("tone_delta", "must be null in single-period mode");
  }
  return { ok: issues.length === 0, issues };
}
