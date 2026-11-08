import type { IntegrityIssue } from "./fundamental-integrity";

export interface HardExclusion {
  cik: number;
  concept: string;
  periodEnd: string;
  accessionNo: string | null;
  issueType: "availability_inversion" | "unit_conflict" | "missing_period";
  reason: string;
}
export interface ContinuityExclusion {
  cik: number;
  concept: string;
  missingQuarter: string;
  excludedAnchorQuarters: string[];
  reportedAt: string[];
}
export interface RevenueExclusionMap {
  schemaVersion: 1;
  status: "draft_not_for_training";
  hardExclusions: HardExclusion[];
  continuityExclusions: ContinuityExclusion[];
  reviewRequired: { cik: number; concept?: string; periodEnd?: string; issueType: string; message: string }[];
}

const quarterIndex = (periodEnd: string): number => {
  const match = /^(\d{4})Q([1-4])$/.exec(periodEnd);
  if (!match) throw new Error(`Invalid quarter label ${periodEnd}`);
  return Number(match[1]) * 4 + Number(match[2]) - 1;
};
const quarterLabel = (index: number): string => `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
const missingPattern = /missing quarters in (?:expected|canonical) grid: (.+)$/;

export function quarterRangeForTtm(missingQuarter: string): string[] {
  const index = quarterIndex(missingQuarter);
  return Array.from({ length: 4 }, (_, offset) => quarterLabel(index + offset));
}

export function buildRevenueExclusionMap(issues: IntegrityIssue[]): RevenueExclusionMap {
  const hardExclusions: HardExclusion[] = [];
  const continuity = new Map<string, ContinuityExclusion>();
  const reviewRequired: RevenueExclusionMap["reviewRequired"] = [];
  const hardKeys = new Set<string>();
  for (const issue of issues) {
    if (!issue.concept || !issue.periodEnd) {
      reviewRequired.push({ cik: issue.cik, concept: issue.concept, periodEnd: issue.periodEnd, issueType: issue.type, message: issue.message });
      continue;
    }
    if (["availability_inversion", "unit_conflict", "missing_period"].includes(issue.type)) {
      const key = `${issue.cik}|${issue.concept}|${issue.periodEnd}|${issue.accessionNo ?? ""}|${issue.type}`;
      if (!hardKeys.has(key)) {
        hardKeys.add(key);
        hardExclusions.push({
          cik: issue.cik,
          concept: issue.concept,
          periodEnd: issue.periodEnd,
          accessionNo: issue.accessionNo ?? null,
          issueType: issue.type as HardExclusion["issueType"],
          reason: issue.message,
        });
      }
      continue;
    }
    if (issue.type === "continuity_gap") {
      const match = issue.message.match(missingPattern);
      if (!match) {
        reviewRequired.push({ cik: issue.cik, concept: issue.concept, periodEnd: issue.periodEnd, issueType: issue.type, message: issue.message });
        continue;
      }
      const missingQuarters = match[1].split(",").map((value) => value.trim()).filter((value) => /^\d{4}Q[1-4]$/.test(value));
      if (!missingQuarters.length) {
        reviewRequired.push({ cik: issue.cik, concept: issue.concept, periodEnd: issue.periodEnd, issueType: issue.type, message: issue.message });
        continue;
      }
      for (const missingQuarter of missingQuarters) {
        const key = `${issue.cik}|${issue.concept}|${missingQuarter}`;
        const existing = continuity.get(key) ?? { cik: issue.cik, concept: issue.concept, missingQuarter, excludedAnchorQuarters: quarterRangeForTtm(missingQuarter), reportedAt: [] };
        if (!existing.reportedAt.includes(issue.periodEnd)) existing.reportedAt.push(issue.periodEnd);
        continuity.set(key, existing);
      }
      continue;
    }
    reviewRequired.push({ cik: issue.cik, concept: issue.concept, periodEnd: issue.periodEnd, issueType: issue.type, message: issue.message });
  }
  hardExclusions.sort((a, b) => a.cik - b.cik || a.concept.localeCompare(b.concept) || a.periodEnd.localeCompare(b.periodEnd) || a.issueType.localeCompare(b.issueType));
  return {
    schemaVersion: 1,
    status: "draft_not_for_training",
    hardExclusions,
    continuityExclusions: [...continuity.values()].sort((a, b) => a.cik - b.cik || a.concept.localeCompare(b.concept) || a.missingQuarter.localeCompare(b.missingQuarter)).map((row) => ({ ...row, reportedAt: [...row.reportedAt].sort() })),
    reviewRequired,
  };
}
