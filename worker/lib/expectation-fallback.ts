import { z } from "zod";
import { evidenceInSource, type ExpectationPromptContext } from "./expectations";

export const EXPECTATION_FALLBACK_VERSION = "expectations-fallback-v1";

export const expectationFallbackSchema = z.object({
  summary: z.string().min(1),
  dataQuality: z.enum(["usable", "limited", "unusable"]),
  guidancePresence: z.enum(["present", "absent", "unclear"]),
  limitations: z.array(z.string()).max(8),
  evidence: z.string().min(1),
}).strict();
export type ExpectationFallback = z.infer<typeof expectationFallbackSchema>;

export const EXPECTATION_FALLBACK_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    dataQuality: { type: "string", enum: ["usable", "limited", "unusable"] },
    guidancePresence: { type: "string", enum: ["present", "absent", "unclear"] },
    limitations: { type: "array", maxItems: 8, items: { type: "string" } },
    evidence: { type: "string" },
  },
  required: ["summary", "dataQuality", "guidancePresence", "limitations", "evidence"],
} as const;

export function buildExpectationFallbackPrompt(text: string, context: ExpectationPromptContext): string {
  return `You are writing a factual fallback note after a strict structured extraction failed. Read only the target source. Do not force it into any schema and do not invent guidance.

Ticker: ${context.ticker}
Form: ${context.form}
Filing date: ${context.filingDate}
Accession: ${context.accessionNo}
Fallback contract: ${EXPECTATION_FALLBACK_VERSION}

Return ONLY one JSON object with:
- summary: a short factual description of the document's substantive content, if any;
- dataQuality: usable for substantive actual financial/operating data, limited for incomplete, old, unclear or mostly procedural content, unusable for no investment-relevant substance;
- guidancePresence: present, absent or unclear, based only on explicit forward-looking management expectations in the target source;
- limitations: up to 8 concise reasons for the quality assessment;
- evidence: one contiguous verbatim quote from the target source that supports the summary and quality assessment.

Never use prior knowledge or other documents. Do not predict market reaction, valuation or trade direction. Do not assign a numeric confidence score. Do not turn old age alone into unusable data.

TARGET TEXT:
"""
${text}
"""`;
}

export function parseExpectationFallback(reply: string): ExpectationFallback | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = expectationFallbackSchema.safeParse(JSON.parse(reply.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function fallbackEvidenceVerified(fallback: ExpectationFallback, source: string): boolean {
  return evidenceInSource(fallback.evidence, source);
}
