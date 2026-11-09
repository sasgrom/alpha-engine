import type { CohortResultEntry } from "./cohort-checkpoint";
import type { CanonicalExpectationStatement } from "./expectation-normalization";

export const V33_TRIO_CIKS = new Set([1018724, 789019, 1652044]);

type ResultEntry = CohortResultEntry & { statements: CanonicalExpectationStatement[] };
const key = (entry: Pick<ResultEntry, "cik" | "accessionNo" | "sourceId" | "containerId">) => `${entry.cik}|${entry.accessionNo}|${entry.sourceId}|${entry.containerId}`;

export function mergeV33Results(v32Results: ResultEntry[], trioResults: ResultEntry[]): ResultEntry[] {
  const merged = new Map<string, ResultEntry>();
  for (const entry of v32Results) {
    if (!V33_TRIO_CIKS.has(entry.cik)) merged.set(key(entry), entry);
  }
  for (const entry of trioResults) merged.set(key(entry), entry);
  return [...merged.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

export function assertV32OtherResultsByteIdentical(v32Results: ResultEntry[], mergedResults: ResultEntry[]): true {
  const other = (entries: ResultEntry[]) => entries.filter((entry) => !V33_TRIO_CIKS.has(entry.cik)).map((entry) => ({ ...entry, statements: entry.statements }));
  if (JSON.stringify(other(v32Results)) !== JSON.stringify(other(mergedResults))) {
    throw new Error("Normalized results for the 50 unchanged companies differ from v3.2");
  }
  return true;
}

export function extractionContextFor(cik: number, contextTokens: number): string {
  return V33_TRIO_CIKS.has(cik) ? "ollama_ctx_131072" : `ollama_ctx_${contextTokens}`;
}
