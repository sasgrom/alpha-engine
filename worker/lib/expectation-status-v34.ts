import { createHash } from "node:crypto";
import type { CohortResultEntry } from "./cohort-checkpoint";
import type { CanonicalExpectationStatement } from "./expectation-normalization";
import { EXPECTATION_NORMALIZATION_V34 } from "./expectation-normalization-v34";

type Entry = CohortResultEntry & { statements: CanonicalExpectationStatement[] };

export function deferredToCallEvidence(entry: Entry, sourceText: string): boolean {
  if (entry.guidanceStatus !== "not_found" || entry.statements.length !== 0) return false;
  const warningEvidence = entry.extractionWarnings.some((warning) => /provide forward-looking guidance/i.test(warning) && /conference call|earnings call/i.test(warning));
  const normalized = sourceText.replace(/\s+/g, " ");
  return warningEvidence && /will provide forward-looking guidance[^.]{0,240}(?:conference call|earnings call)/i.test(normalized);
}

export function applyV34DeferredStatus(entries: Entry[], sourceTextFor: (entry: Entry) => string) {
  const resultAudit = [];
  const output = entries.map((entry) => {
    const sourceText = sourceTextFor(entry);
    if (!deferredToCallEvidence(entry, sourceText)) return entry;
    resultAudit.push({
      cik: entry.cik,
      ticker: entry.ticker,
      accessionNo: entry.accessionNo,
      sourceId: entry.sourceId,
      containerId: entry.containerId,
      ruleId: "GUIDANCE_STATUS_DEFERRED_TO_CALL",
      normalizationVersion: EXPECTATION_NORMALIZATION_V34,
      beforeGuidanceStatus: entry.guidanceStatus,
      afterGuidanceStatus: "deferred_to_call",
      evidenceSha256: createHash("sha256").update(sourceText).digest("hex"),
    });
    return { ...entry, guidanceStatus: "deferred_to_call" };
  });
  return { entries: output, resultAudit };
}
