import { createHash } from "node:crypto";
import { cohortSourceText, type CohortPack } from "./cohort-pack";
import { rejectUnsupportedStatements } from "./expectations";
import type { CohortResultEntry } from "./cohort-checkpoint";

export interface CohortQaIssue {
  type: "output_truncated" | "context_overflow" | "found_without_statements" | "evidence_mismatch" | "missing_target" | "not_found_with_expectation_language";
  sourceId: string;
  containerId: string;
  detail: string;
}
export interface CohortQaReport {
  schemaVersion: 1;
  cik: number | null;
  ticker: string | null;
  packGeneratedAt: string;
  status: "pass" | "review" | "incomplete" | "fail";
  summary: {
    packSources: number;
    completedSources: number;
    missingSources: number;
    staleSources: number;
    statements: number;
    emptyResponses: number;
    notFound: number;
    fallback: number;
    missingUsage: number;
    medianPromptTokens: number;
    p95PromptTokens: number;
    medianGeneratedTokens: number;
    p95GeneratedTokens: number;
    hardErrors: number;
    reviewFlags: number;
  };
  issues: CohortQaIssue[];
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const EXPECTATION_LANGUAGE_RE = /\b(?:guidance|outlook|forecast|expect|expects|expected|anticipate|anticipates|anticipated|project|projection|target)\b/i;
const quantile = (values: number[], q: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
};

export function auditCohortResults(pack: CohortPack, entries: CohortResultEntry[]): CohortQaReport {
  const issues: CohortQaIssue[] = [];
  const tasks = pack.containers.flatMap((container) => container.sources.map((source) => ({ container, source, inputSha256: sha256(`${source.sourceId}\n${container.inputSha256}`) })));
  const completedKeys = new Set<string>();
  let staleSources = 0;
  for (const { container, source, inputSha256 } of tasks) {
    const entry = entries.find((item) => item.containerId === container.containerId && item.sourceId === source.sourceId);
    if (!entry) continue;
    if (entry.inputSha256 !== inputSha256) staleSources++;
    else completedKeys.add(`${container.containerId}\n${source.sourceId}`);
  }
  for (const entry of entries) {
    const container = pack.containers.find((item) => item.containerId === entry.containerId);
    const targetText = container ? cohortSourceText(container, entry.sourceId) : null;
    if (!targetText) {
      issues.push({ type: "missing_target", sourceId: entry.sourceId, containerId: entry.containerId, detail: "No exact target block exists in the current pack." });
      continue;
    }
    if (entry.usage && entry.usage.evalCount >= pack.outputTokens) {
      issues.push({ type: "output_truncated", sourceId: entry.sourceId, containerId: entry.containerId, detail: `Main generation reached ${entry.usage.evalCount}/${pack.outputTokens} tokens.` });
    }
    if (entry.fallbackUsage && entry.fallbackUsage.evalCount >= 1024) {
      issues.push({ type: "output_truncated", sourceId: entry.sourceId, containerId: entry.containerId, detail: "Fallback generation reached its 1024-token cap." });
    }
    const promptTokens = (entry.usage?.promptTokens ?? 0) + (entry.fallbackUsage?.promptTokens ?? 0);
    const generatedTokens = (entry.usage?.evalCount ?? 0) + (entry.fallbackUsage?.evalCount ?? 0);
    if (promptTokens + generatedTokens > pack.contextTokens) {
      issues.push({ type: "context_overflow", sourceId: entry.sourceId, containerId: entry.containerId, detail: `${promptTokens} prompt + ${generatedTokens} generated exceeds ${pack.contextTokens}.` });
    }
    if (entry.guidanceStatus === "found" && entry.statements.length === 0) {
      issues.push({ type: "found_without_statements", sourceId: entry.sourceId, containerId: entry.containerId, detail: "guidanceStatus=found but no structured statement survived." });
    }
    if (entry.guidanceStatus) {
      const checked = rejectUnsupportedStatements({ guidanceStatus: entry.guidanceStatus, statements: entry.statements, extractionWarnings: entry.extractionWarnings }, targetText);
      if (checked.rejected > 0) {
        issues.push({ type: "evidence_mismatch", sourceId: entry.sourceId, containerId: entry.containerId, detail: `${checked.rejected} stored statement(s) lack contiguous target-source evidence.` });
      }
    } else if (entry.statements.length) {
      issues.push({ type: "evidence_mismatch", sourceId: entry.sourceId, containerId: entry.containerId, detail: "Statements exist without guidanceStatus." });
    }
    if (entry.guidanceStatus === "not_found" && EXPECTATION_LANGUAGE_RE.test(targetText)) {
      issues.push({ type: "not_found_with_expectation_language", sourceId: entry.sourceId, containerId: entry.containerId, detail: "Heuristic review only: target contains guidance/outlook language; this is not proof of missed guidance." });
    }
  }
  const hardTypes = new Set(["output_truncated", "context_overflow", "found_without_statements", "evidence_mismatch", "missing_target"]);
  const hardErrors = issues.filter((issue) => hardTypes.has(issue.type)).length;
  const reviewFlags = issues.length - hardErrors;
  const missingSources = tasks.length - completedKeys.size;
  const promptTokens = entries.map((entry) => entry.usage?.promptTokens ?? 0).filter((value) => value > 0);
  const generatedTokens = entries.map((entry) => entry.usage?.evalCount ?? 0).filter((value) => value > 0);
  return {
    schemaVersion: 1,
    cik: entries[0]?.cik ?? null,
    ticker: entries[0]?.ticker ?? null,
    packGeneratedAt: pack.generatedAt,
    status: hardErrors ? "fail" : missingSources ? "incomplete" : reviewFlags ? "review" : "pass",
    summary: {
      packSources: tasks.length,
      completedSources: completedKeys.size,
      missingSources,
      staleSources,
      statements: entries.reduce((total, entry) => total + entry.statements.length, 0),
      emptyResponses: entries.filter((entry) => entry.statements.length === 0).length,
      notFound: entries.filter((entry) => entry.guidanceStatus === "not_found").length,
      fallback: entries.filter((entry) => entry.fallbackUsage).length,
      missingUsage: entries.filter((entry) => !entry.usage).length,
      medianPromptTokens: quantile(promptTokens, 0.5),
      p95PromptTokens: quantile(promptTokens, 0.95),
      medianGeneratedTokens: quantile(generatedTokens, 0.5),
      p95GeneratedTokens: quantile(generatedTokens, 0.95),
      hardErrors,
      reviewFlags,
    },
    issues,
  };
}
