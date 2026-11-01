import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
import type { SchwabFundamentalGapMap } from "./schwab-fundamental-gap-map";
import type { RecentGapDiagnosisReport } from "./edgar-recent-gap-diagnosis";
export type RemediationNextAction = "fix_availability_before_factor" | "edgar_refresh_recent" | "review_fact_ingestion" | "review_taxonomy_aliases" | "review_source_sparse_gaps" | "review_schwab_candidates" | "edgar_only_no_replacement";
export interface CompanyRemediationPlan {
  ticker: string;
  apply: boolean;
  strict: boolean;
  stages: string[];
  edgarErrors: number;
  recentErrors: number;
  availabilityInversions: number;
  directCandidates: number;
  derivedCandidates: number;
  unsupportedConcepts: number;
  recentGapConcepts: number;
  recoverableQuarters: number;
  aliasQuarters: number;
  unavailableQuarters: number;
  nextAction: RemediationNextAction;
}
export function buildCompanyRemediationPlan(params: {
  ticker: string;
  gapAnalysis: EdgarGapAnalysis;
  gapMap: SchwabFundamentalGapMap;
  recentGapDiagnosis?: RecentGapDiagnosisReport;
  apply: boolean;
  strict: boolean;
}): CompanyRemediationPlan {
  const { ticker, gapAnalysis, gapMap, recentGapDiagnosis, apply, strict } = params;
  const recentErrors = gapAnalysis.byEra.filter((row) => ["2020-2024", "2025-2026"].includes(row.era)).reduce((total, row) => total + row.errors, 0);
  const availabilityInversions = gapAnalysis.byType.find((row) => row.type === "availability_inversion")?.count ?? 0;
  const directCandidates = gapMap.coverage.direct, derivedCandidates = gapMap.coverage.derived, unsupportedConcepts = gapMap.coverage.unsupported;
  const diagnosedAction: RemediationNextAction = !recentGapDiagnosis
    ? "edgar_refresh_recent"
    : recentGapDiagnosis.summary.recoverableQuarters > 0 ? "review_fact_ingestion"
    : recentGapDiagnosis.summary.aliasQuarters > 0 ? "review_taxonomy_aliases"
    : "review_source_sparse_gaps";
  const nextAction: RemediationNextAction = availabilityInversions > 0
    ? "fix_availability_before_factor"
    : recentErrors > 0 ? diagnosedAction
    : directCandidates + derivedCandidates > 0 ? "review_schwab_candidates" : "edgar_only_no_replacement";
  return {
    ticker, apply, strict,
    stages: apply
      ? ["edgar-fetch", "edgar-exhibits", "facts-fetch", "integrity-audit", "gap-analysis", "recent-gap-diagnosis", "schwab-gap-map"]
      : ["integrity-audit", "gap-analysis", "recent-gap-diagnosis", "schwab-gap-map"],
    edgarErrors: gapAnalysis.summary.errors,
    recentErrors,
    availabilityInversions,
    directCandidates,
    derivedCandidates,
    unsupportedConcepts,
    recentGapConcepts: recentGapDiagnosis?.summary.concepts ?? 0,
    recoverableQuarters: recentGapDiagnosis?.summary.recoverableQuarters ?? 0,
    aliasQuarters: recentGapDiagnosis?.summary.aliasQuarters ?? 0,
    unavailableQuarters: recentGapDiagnosis?.summary.unavailableQuarters ?? 0,
    nextAction,
  };
}
