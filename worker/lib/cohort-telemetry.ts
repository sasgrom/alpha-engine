export interface CohortSourceTiming {
  wallMs: number;
  llmMs: number;
  promptTokens: number;
  evalCount: number;
  fallback: boolean;
}
export interface CohortWindowTelemetry {
  sources: number;
  documentsPerMinute: number;
  meanPromptTokens: number;
  meanEvalCount: number;
  fallbackShare: number;
  meanLlmMs: number;
  meanOtherMs: number;
}

export function summarizeCohortWindow(rows: CohortSourceTiming[]): CohortWindowTelemetry {
  if (!rows.length) return { sources: 0, documentsPerMinute: 0, meanPromptTokens: 0, meanEvalCount: 0, fallbackShare: 0, meanLlmMs: 0, meanOtherMs: 0 };
  const sum = (select: (row: CohortSourceTiming) => number) => rows.reduce((total, row) => total + select(row), 0);
  const wallMs = sum((row) => row.wallMs);
  return {
    sources: rows.length,
    documentsPerMinute: wallMs > 0 ? rows.length * 60_000 / wallMs : 0,
    meanPromptTokens: sum((row) => row.promptTokens) / rows.length,
    meanEvalCount: sum((row) => row.evalCount) / rows.length,
    fallbackShare: rows.filter((row) => row.fallback).length / rows.length,
    meanLlmMs: sum((row) => row.llmMs) / rows.length,
    meanOtherMs: Math.max(0, wallMs - sum((row) => row.llmMs)) / rows.length,
  };
}

export function formatCohortWindow(rows: CohortSourceTiming[]): string {
  const window = summarizeCohortWindow(rows.slice(-10));
  return `rolling ${window.documentsPerMinute.toFixed(1)}/min · last ${window.sources} new sources · prompt ${Math.round(window.meanPromptTokens).toLocaleString("en-US")} tok · generated ${Math.round(window.meanEvalCount).toLocaleString("en-US")} tok · fallback ${(window.fallbackShare * 100).toFixed(0)}% · LLM ${(window.meanLlmMs / 1000).toFixed(1)}s · other ${(window.meanOtherMs / 1000).toFixed(1)}s`;
}
