import { z } from "zod";
import { isEightKForm } from "./edgar";
import { MAX_INPUT_CHARS } from "./ollama";

export const EXPECTATIONS_PROMPT_VERSION = "expectations-v2";
export const EXPECTATIONS_SCHEMA_VERSION = 2;

const nullableNumber = z.number().finite().nullable();
const statementSchema = z.object({
  kind: z.enum(["guidance", "actual", "assumption", "financing", "timing", "non_disclosure"]),
  metricRaw: z.string().min(1).max(160),
  metric: z.enum([
    "revenue", "operating_income", "net_income", "eps", "ebitda", "capex", "opex",
    "free_cash_flow", "operating_cash_flow", "debt", "margin", "tax_rate", "nii",
    "expense", "segment_revenue", "segment_profit", "backlog", "other",
  ]),
  scopeRaw: z.string().min(1).max(180),
  periodRaw: z.string().min(1).max(120),
  comparisonRaw: z.string().max(180).nullable(),
  qualifier: z.enum(["range", "point", "plus_minus", "at_least", "at_most", "approximately", "unchanged", "qualitative", "not_provided"]),
  valueLow: nullableNumber,
  valueHigh: nullableNumber,
  valuePoint: nullableNumber,
  tolerance: nullableNumber,
  toleranceUnit: z.enum(["percent", "basis_points", "same_unit"]).nullable(),
  valueText: z.string().max(120).nullable(),
  unit: z.enum(["usd", "usd_millions", "usd_billions", "usd_per_share", "percent", "basis_points", "ratio", "days", "count", "text", "other"]),
  basis: z.enum(["gaap", "non_gaap", "reported", "adjusted", "mixed", "unclear"]),
  currencyBasis: z.enum(["reported", "constant_currency", "unclear"]),
  revision: z.enum(["initial", "raised", "lowered", "narrowed", "widened", "reaffirmed", "actual", "not_provided", "unclear"]),
  previousLow: nullableNumber,
  previousHigh: nullableNumber,
  previousPoint: nullableNumber,
  previousGuidanceDateRaw: z.string().max(120).nullable(),
  assumptionRaw: z.string().max(500).nullable(),
  sourceSection: z.string().max(180).nullable(),
  evidence: z.string().min(1).max(2500),
}).strict();

export const expectationResponseSchema = z.object({
  guidanceStatus: z.enum(["found", "not_found", "explicitly_not_provided", "deferred_to_call"]),
  statements: z.array(statementSchema).max(60),
  extractionWarnings: z.array(z.string()).max(12),
}).strict();

export type ExpectationStatement = z.infer<typeof statementSchema>;
export type ExpectationResponse = z.infer<typeof expectationResponseSchema>;

export interface ExpectationPromptContext {
  ticker: string;
  form: string;
  filingDate: string;
  accessionNo: string;
}

/** JSON Schema passed to Ollama; the Zod contract remains the authoritative validator. */
export const EXPECTATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    guidanceStatus: { type: "string", enum: ["found", "not_found", "explicitly_not_provided", "deferred_to_call"] },
    statements: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["guidance", "actual", "assumption", "financing", "timing", "non_disclosure"] },
          metricRaw: { type: "string" }, metric: { type: "string" }, scopeRaw: { type: "string" }, periodRaw: { type: "string" },
          comparisonRaw: { anyOf: [{ type: "string" }, { type: "null" }] },
          qualifier: { type: "string" }, valueLow: { anyOf: [{ type: "number" }, { type: "null" }] },
          valueHigh: { anyOf: [{ type: "number" }, { type: "null" }] }, valuePoint: { anyOf: [{ type: "number" }, { type: "null" }] },
          tolerance: { anyOf: [{ type: "number" }, { type: "null" }] }, toleranceUnit: { anyOf: [{ type: "string" }, { type: "null" }] },
          valueText: { anyOf: [{ type: "string" }, { type: "null" }] }, unit: { type: "string" }, basis: { type: "string" }, currencyBasis: { type: "string" }, revision: { type: "string" },
          previousLow: { anyOf: [{ type: "number" }, { type: "null" }] }, previousHigh: { anyOf: [{ type: "number" }, { type: "null" }] },
          previousPoint: { anyOf: [{ type: "number" }, { type: "null" }] }, previousGuidanceDateRaw: { anyOf: [{ type: "string" }, { type: "null" }] },
          assumptionRaw: { anyOf: [{ type: "string" }, { type: "null" }] }, sourceSection: { anyOf: [{ type: "string" }, { type: "null" }] },
          evidence: { type: "string" },
        },
        required: [
          "kind", "metricRaw", "metric", "scopeRaw", "periodRaw", "comparisonRaw", "qualifier", "valueLow", "valueHigh",
          "valuePoint", "tolerance", "toleranceUnit", "valueText", "unit", "basis", "currencyBasis", "revision", "previousLow", "previousHigh",
          "previousPoint", "previousGuidanceDateRaw", "assumptionRaw", "sourceSection", "evidence",
        ],
      },
    },
    extractionWarnings: { type: "array", items: { type: "string" } },
  },
  required: ["guidanceStatus", "statements", "extractionWarnings"],
} as const;

export function buildExpectationPrompt(text: string, context: ExpectationPromptContext): string {
  return `You extract management expectations and comparable reported metrics from SEC filings for point-in-time research.

Ticker: ${context.ticker}
Form: ${context.form}
Filing date: ${context.filingDate}
Accession: ${context.accessionNo}
Extraction contract: ${EXPECTATIONS_PROMPT_VERSION}

Return ONLY one JSON object matching the supplied schema. Extract facts; do not score sentiment and do not predict market reaction.

Rules:
- guidanceStatus=found when numeric or substantive qualitative management guidance exists. Use deferred_to_call when the document points to a call for guidance. Use explicitly_not_provided only when management explicitly declines a guidance metric. Use not_found when no guidance is present in this document.
- Extract every material guidance statement and the reported actual metrics needed to compare it later. Include segment metrics, cash flow, capex, debt/financing and timing adjustments when they explain the outlook or headline result.
- Preserve the exact metric, segment/scope, target period and comparison period. Store accounting basis (GAAP/non-GAAP/adjusted) separately from currencyBasis (reported/constant_currency). Never compare different bases yourself.
- range: valueLow/valueHigh. point: valuePoint. plus_minus: valuePoint plus tolerance/toleranceUnit. at_least: valueLow. at_most: valueHigh. approximately: valuePoint. Keep qualitative phrases such as "high teens" in valueText with numeric fields null.
- raised/lowered/narrowed/widened/reaffirmed refer to guidance vintage, not year-over-year results. Populate previous* only when the document states prior guidance; never infer it from a different filing.
- Do not perform arithmetic, midpoint calculations, annualization, FX adjustment or unit conversion. Do not invent consensus, analyst expectations, dates, values or causal explanations.
- kind=non_disclosure only for an explicit absence. Assumptions such as FX, China revenue, legal charges, event timing or market dependence must remain attached in assumptionRaw.
- evidence must be a contiguous verbatim quote from the supplied text containing the values and qualifiers used by that statement. Whitespace may differ. Do not paraphrase evidence.
- If a table is ambiguous, preserve raw text and add an extractionWarning instead of guessing.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function evidenceInSource(evidence: string, source: string): boolean {
  const needle = normalizeEvidence(evidence);
  return needle.length >= 20 && normalizeEvidence(source).includes(needle);
}

export function parseExpectationResponse(reply: string): ExpectationResponse | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = expectationResponseSchema.safeParse(JSON.parse(reply.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function rejectUnsupportedStatements(response: ExpectationResponse, source: string) {
  const statements = response.statements.filter((statement) => evidenceInSource(statement.evidence, source));
  return {
    response: { ...response, statements },
    rejected: response.statements.length - statements.length,
  };
}

interface TextBlock { start: number; end: number; text: string }
const HEADING_RE = /(?:guidance|outlook)/i;
const NON_MANAGEMENT_HEADING_RE = /(?:accounting|derivative|regulatory|income tax|tax guidance|audit|fair value|internal control|revenue recognition|environmental|privacy|cyber|sanctions|import|export)/i;
const EXPECTATION_RE = /\b(?:guidance|outlook|expect|expects|expected|anticipate|anticipates|anticipated|project|projection|forecast|target)\b/i;
const STRONG_EXPECTATION_RE = /(?:(?:we|management|the company|the firm)\s+(?:currently\s+)?(?:expect|expects|anticipate|anticipates)|(?:revenue|sales|income|expenses?|capex|capital expenditures|eps|guidance)\b.{0,50}\b(?:is|are)\s+expected|outlook information)/i;
const NUMBER_RE = /(?:\d+(?:\.\d+)?\s*%|\$\s*\d|\b\d+(?:\.\d+)?\s*(?:billion|million|basis points|bps)\b)/i;

/** Locate guidance/outlook blocks without treating accounting-guidance text as management guidance. */
export function selectExpectationText(plain: string, form: string, maxChars = MAX_INPUT_CHARS): { status: "ok" | "no_candidate_text"; text: string; blocks: number } {
  if (isEightKForm(form) && plain.length <= maxChars) return { status: "ok", text: plain, blocks: 1 };
  const lines = plain.split("\n");
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }
  const blocks: TextBlock[] = [];
  const addBlock = (startLine: number, endLine: number) => {
    const start = offsets[Math.max(0, startLine)] ?? 0;
    const rawEnd = endLine >= lines.length ? plain.length : (offsets[endLine] ?? plain.length);
    const end = Math.min(rawEnd, start + 16_000);
    const text = plain.slice(start, end).trim();
    if (text.length < 30 || !EXPECTATION_RE.test(text) || !NUMBER_RE.test(text)) return;
    const previous = blocks.at(-1);
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.text = plain.slice(previous.start, previous.end).trim();
    } else {
      blocks.push({ start, end, text });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length > 0 && line.length <= 140 && HEADING_RE.test(line) && !NON_MANAGEMENT_HEADING_RE.test(line)) addBlock(i, Math.min(lines.length, i + 90));
  }
  if (!blocks.length) {
    for (let i = 0; i < lines.length; i++) {
      if (STRONG_EXPECTATION_RE.test(lines[i]) && NUMBER_RE.test(lines[i])) addBlock(Math.max(0, i - 5), Math.min(lines.length, i + 12));
    }
  }
  if (!blocks.length) return { status: "no_candidate_text", text: "", blocks: 0 };
  const parts: string[] = [];
  let size = 0;
  for (const block of blocks) {
    const remaining = maxChars - size;
    if (remaining <= 0) break;
    const text = block.text.slice(0, remaining);
    parts.push(text);
    size += text.length + 28;
  }
  return { status: "ok", text: parts.join("\n\n--- SOURCE BLOCK ---\n\n"), blocks: parts.length };
}
