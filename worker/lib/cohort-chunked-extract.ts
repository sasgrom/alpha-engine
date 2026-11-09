import { buildExpectationPrompt, EXPECTATION_JSON_SCHEMA, type ExpectationPromptContext, type ExpectationResponse } from "./expectations";
import { generate } from "./ollama";
import { parseExpectationResponseDetailed } from "./expectations";
import { mergeGuidanceStatus } from "./exhibits";
import type { CohortUsage } from "./cohort-checkpoint";

export function splitCohortSourceText(text: string, maxChars = 2000): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && Buffer.byteLength(`${current}\n${line}`) > maxChars) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function extractCohortSourceInChunks(
  targetText: string,
  context: ExpectationPromptContext,
  outputTokens = 8192,
  generateFn: typeof generate = generate,
): Promise<{ response: ExpectationResponse; usage: CohortUsage; rawResponse: string; outputTruncated: boolean; outputTokens: number }> {
  const chunks = splitCohortSourceText(targetText);
  const outputCap = Math.max(8192, Math.floor(outputTokens / 4));
  const usage: CohortUsage = { promptTokens: 0, evalCount: 0, promptMs: 0, evalMs: 0, totalMs: 0 };
  const responses: ExpectationResponse[] = [];
  const rawResponses: string[] = [];
  let outputTruncated = false;
  for (const [index, chunk] of chunks.entries()) {
    const prompt = `${buildExpectationPrompt(chunk, context)}\n\nCHUNK ROUTING: This is part ${index + 1}/${chunks.length} of the same source. Extract only statements explicitly present in this part.`;
    const generated = await generateFn(prompt, { jsonSchema: EXPECTATION_JSON_SCHEMA, numPredict: outputCap, timeoutMs: 180_000 });
    usage.promptTokens += generated.promptEvalCount;
    usage.evalCount += generated.evalCount;
    usage.promptMs += generated.promptEvalMs;
    usage.evalMs += generated.evalMs;
    usage.totalMs += generated.totalMs;
    if (generated.evalCount >= outputCap) outputTruncated = true;
    rawResponses.push(generated.text);
    const parsed = parseExpectationResponseDetailed(generated.text);
    if (!parsed.response) {
      const error = new Error(`Chunk ${index + 1}/${chunks.length} schema failure: ${parsed.issues.join(" | ")}`) as Error & { outputTruncated?: boolean; rawResponses?: string[] };
      error.outputTruncated = outputTruncated;
      error.rawResponses = rawResponses;
      throw error;
    }
    responses.push(parsed.response);
  }
  const statements = [...new Map(responses.flatMap((response) => response.statements).map((statement) => [`${statement.metricRaw}|${statement.scopeRaw}|${statement.periodRaw}|${statement.basis}|${statement.qualifier}|${statement.evidence}`, statement] as const)).values()];
  return {
    response: {
      guidanceStatus: mergeGuidanceStatus(responses.map((response) => response.guidanceStatus)) ?? "not_found",
      statements,
      extractionWarnings: responses.flatMap((response) => response.extractionWarnings),
    },
    usage,
    rawResponse: JSON.stringify(rawResponses),
    outputTruncated,
    outputTokens: outputCap * chunks.length,
  };
}
