/**
 * Stage 2.2 — Scoring rubric: scale anchors + the deterministic prompt.
 *
 * The prompt is in English (the documents are English, the model is more
 * precise); comments are in English as well (project convention since
 * iteration 3c). Scale anchors are the calibration base: without them
 * "score −1..1" has no shared frame of reference for the LLM and drifts
 * between documents. A PROMPT_VERSION bump = any change to the prompt text
 * or the anchors (scores are versioned by (llm_version, prompt_version)).
 *
 * The methodological frame of the "accounting" aspect is aligned with the
 * accounting plugin (xtt-corporate-finance-accounting): restatements,
 * accounting-policy changes, critical estimates, internal control
 * weaknesses.
 */
import { ASPECTS, type Aspect } from "./contract";

/** Prompt version — part of the sentiment_scores idempotency key. */
export const PROMPT_VERSION = "v2";

/** Scale anchors: what -1, -0.5, 0, +0.5, +1 mean for each aspect. */
export const SCALE_ANCHORS: Record<Aspect, { p1: string; p05: string; zero: string; n05: string; n1: string }> = {
  outlook: {
    p1: "Explicitly raised guidance or strongly upbeat forward statements with specifics (numbers, timelines)",
    p05: "Cautiously optimistic outlook; guidance reaffirmed with positive tilt",
    zero: "Boilerplate forward-looking statements; no guidance change; purely hedged language",
    n05: "Guidance lowered or outlook notably more cautious than before",
    n1: "Guidance withdrawn/slashed, explicit profit warning, or management signals severe deterioration",
  },
  demand: {
    p1: "Clear evidence of accelerating demand: record orders, backlog growth, pricing power from scarcity",
    p05: "Healthy demand language with supporting detail (volume growth, share gains)",
    zero: "Demand described neutrally or only via restated financials",
    n05: "Softening demand signals: destocking, slower orders, cautious customer commentary",
    n1: "Explicit demand collapse: order cancellations, backlog drawdowns, major customer losses",
  },
  margins: {
    p1: "Structural margin expansion with durable drivers (mix shift, pricing, cost programs ahead of plan)",
    p05: "Margins improving or expected to improve; cost discipline emphasized",
    zero: "Margins stable or not discussed beyond reported figures",
    n05: "Margin pressure acknowledged (input costs, mix, investments) but framed as manageable",
    n1: "Severe margin erosion: gross margin collapse, pricing breakdown, runaway cost growth",
  },
  liquidity: {
    p1: "Fortress liquidity: large cash pile vs minimal debt, upsized revolver, covenant headroom explicit",
    p05: "Comfortable liquidity and cash flow language with specifics",
    zero: "Liquidity section boilerplate; no notable change",
    n05: "Tightening signals: rising leverage, reduced buybacks for cash preservation, covenant proximity",
    n1: "Going-concern language, covenant breach/waiver, distressed refinancing, liquidity crisis",
  },
  capex: {
    p1: "Major capacity/technology investment ramp with clear strategic rationale and committed timelines",
    p05: "Capex increasing moderately, aligned with growth",
    zero: "Capex steady-state maintenance language",
    n05: "Capex cuts, project deferrals, or capex-driven cash strain",
    n1: "Investment program collapse, asset writedowns tied to failed projects, or forced capex halt",
  },
  capital_return: {
    p1: "New/expanded buybacks or dividend growth with explicit board authorization and capacity",
    p05: "Continued steady shareholder returns",
    zero: "Capital return policy unchanged or not discussed",
    n05: "Buyback/dividend pace slowing; more conservative allocation",
    n1: "Dividend cut/suspension, buyback halt under pressure, emergency dilution",
  },
  legal_reg: {
    p1: "Material legal/regulatory resolution in company's favor; regulatory tailwinds",
    p05: "Routine legal disclosures, no material new matters",
    zero: "Standard legal boilerplate; status quo",
    n05: "New investigations/lawsuits disclosed or existing matters escalating",
    n1: "Material adverse judgment, major regulatory action, restatement-triggering investigation",
  },
  accounting: {
    p1: "Accounting quality improving: clean audit, simplified estimates, strengthened controls",
    p05: "No concerns; standard critical-estimate disclosures",
    zero: "Boilerplate accounting-policy language",
    n05: "New critical estimates, policy changes, auditor emphasis-of-matter, control remediation ongoing",
    n1: "Restatement, material weakness in ICFR, auditor resignation, non-reliance notice",
  },
};

/** Anchors for the pairwise MD&A tone delta (vs the prior period). */
export const TONE_DELTA_ANCHORS = {
  p1: "Tone materially more confident: hedging removed, stronger verbs, new positive specifics vs prior period",
  zero: "Tone essentially unchanged; same hedging pattern and specificity",
  n1: "Tone materially darker: new caution language, removed positives, increased hedging vs prior period",
};

/**
 * Deterministic prompt builder. temp=0 + fixed seed + fixed text =
 * reproducible scores (an audit and regression-test requirement).
 */
export function buildScoringPrompt(opts: {
  form: string;
  sectionKey: string;
  text: string;
  /** prior-period MD&A text for the pairwise tone_delta mode */
  priorText?: string | null;
  ticker?: string;
}): string {
  const aspectLines = ASPECTS.map(
    (a) => {
      const r = SCALE_ANCHORS[a];
      return `- ${a}:\n    +1 = ${r.p1}\n    +0.5 = ${r.p05}\n    0 = ${r.zero}\n    -0.5 = ${r.n05}\n    -1 = ${r.n1}`;
    }
  ).join("\n");

  const pairwise = !!opts.priorText;
  return [
    `You are a forensic financial analyst scoring an SEC filing section for quantitative signal extraction.`,
    `Score EACH aspect on a continuous scale from -1 (very negative) to +1 (very positive), with confidence 0..1 and a VERBATIM evidence quote (max 300 chars, copied exactly from the text).`,
    `Rules: score only what the TEXT supports; boilerplate = 0 with low confidence; never invent facts; evidence must be a literal substring of the CURRENT period source text (the FILING SECTION below) — in pairwise mode NEVER quote the PRIOR PERIOD TEXT as evidence.`,
    ``,
    `ASPECT SCALE ANCHORS:`,
    aspectLines,
    ``,
    pairwise
      ? [
          `TONE DELTA (REQUIRED in pairwise mode — do not omit): compare the CURRENT MD&A against the PRIOR period MD&A below. Score tone_delta -1..+1. Its evidence must also come from the CURRENT period text.`,
          `    +1 = ${TONE_DELTA_ANCHORS.p1}`,
          `    0 = ${TONE_DELTA_ANCHORS.zero}`,
          `    -1 = ${TONE_DELTA_ANCHORS.n1}`,
          ``,
          `=== PRIOR PERIOD TEXT ===`,
          opts.priorText!.slice(0, 30000),
          ``,
        ].join("\n")
      : `tone_delta must be null (single-period mode).`,
    ``,
    `=== FILING SECTION (${opts.form} ${opts.sectionKey}${opts.ticker ? `, ${opts.ticker}` : ""}) ===`,
    opts.text.slice(0, 60000),
    ``,
    `Respond with a single JSON object: {"aspects": {<each aspect>: {"score": <number>, "confidence": <number>, "evidence": "<verbatim quote>"}}, "tone_delta": ${pairwise ? '{"score":..., "confidence":..., "evidence":...}' : "null"}}`,
  ].join("\n");
}
