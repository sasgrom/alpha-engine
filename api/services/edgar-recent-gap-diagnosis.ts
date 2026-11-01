import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
import type { IntegrityIssue } from "./fundamental-integrity";

export type GapDiagnosisStatus = "recoverable" | "alias_candidate" | "unavailable";
export type ReportingCadence = "annual_only" | "quarterly_or_mixed" | "no_recent_facts";
export interface RecentGapDiagnosis {
  concept: string;
  status: GapDiagnosisStatus;
  lastAvailable: string | null;
  recentQuarters: string[];
  recoverableQuarters: string[];
  aliasQuarters: string[];
  unavailableQuarters: string[];
  cadence: ReportingCadence;
  forms: string[];
  recentFactCount: number;
  cadenceAction: "exclude_from_quarterly_imputation" | "evaluate_isolated_gaps" | "inspect_source_history";
  reason: string;
}
export interface RecentGapDiagnosisReport {
  schemaVersion: 1;
  generatedAt: string;
  sourceGapGeneratedAt: string;
  sourceFactsSha256: string;
  cik: number;
  summary: {
    recentErrors: number;
    cadenceExpectedIssues: number;
    concepts: number;
    missingQuarters: number;
    recoverableQuarters: number;
    aliasQuarters: number;
    unavailableQuarters: number;
    annualOnlyConcepts: number;
    annualOnlyQuarters: number;
    quarterlyReviewConcepts: number;
    quarterlyReviewQuarters: number;
  };
  gaps: RecentGapDiagnosis[];
}
interface CompanyFact { end: string; form?: string }
interface CompanyConcept { units: Record<string, CompanyFact[]> }
export interface SecCompanyFacts {
  facts: Record<string, Record<string, CompanyConcept>>;
}

const RECENT_QUARTER = "2020Q1";
const quarterOf = (date: string): string => `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
const twinOf = (concept: string): string | null => concept.endsWith("Noncurrent")
  ? `${concept.slice(0, -10)}Current`
  : concept.endsWith("Current") ? `${concept.slice(0, -7)}Noncurrent` : null;

function conceptsByName(companyFacts: SecCompanyFacts): Map<string, CompanyConcept> {
  const concepts = new Map<string, CompanyConcept>();
  for (const taxonomy of Object.values(companyFacts.facts)) {
    for (const [name, concept] of Object.entries(taxonomy)) {
      if (!concepts.has(name)) concepts.set(name, concept);
    }
  }
  return concepts;
}

function availableQuarters(concept: CompanyConcept | undefined): Set<string> {
  return new Set(
    Object.values(concept?.units ?? {})
      .flat()
      .filter((fact) => /^\d{4}-\d{2}-\d{2}$/.test(fact.end))
      .map((fact) => quarterOf(fact.end)),
  );
}

function reportingCadence(concept: CompanyConcept | undefined): {
  cadence: ReportingCadence;
  forms: string[];
  recentFactCount: number;
  cadenceAction: RecentGapDiagnosis["cadenceAction"];
} {
  const recentFacts = Object.values(concept?.units ?? {}).flat().filter((fact) => fact.end >= "2020-01-01");
  const forms = [...new Set(recentFacts.map((fact) => fact.form).filter((form): form is string => Boolean(form)))].sort();
  const hasAnnual = forms.some((form) => form.startsWith("10-K"));
  const hasQuarterly = forms.some((form) => form.startsWith("10-Q"));
  const cadence: ReportingCadence = !recentFacts.length ? "no_recent_facts" : hasAnnual && !hasQuarterly ? "annual_only" : "quarterly_or_mixed";
  return {
    cadence,
    forms,
    recentFactCount: recentFacts.length,
    cadenceAction: cadence === "annual_only" ? "exclude_from_quarterly_imputation" : cadence === "no_recent_facts" ? "inspect_source_history" : "evaluate_isolated_gaps",
  };
}

export function diagnoseRecentGaps(
  gapAnalysis: EdgarGapAnalysis,
  sourceIssues: IntegrityIssue[],
  companyFacts: SecCompanyFacts,
  cik: number,
  sourceFactsSha256: string,
  generatedAt: string,
): RecentGapDiagnosisReport {
  const concepts = conceptsByName(companyFacts);
  const recentIssues = sourceIssues.filter((issue) =>
    issue.cik === cik && (issue.type === "continuity_gap" || issue.type === "cadence_expected_gap") &&
    Boolean(issue.concept) && Boolean(issue.periodEnd && issue.periodEnd >= "2020-01-01"));
  const recentConcepts = new Set(recentIssues.map((issue) => issue.concept));
  const recentGaps = gapAnalysis.gaps.filter((gap) =>
    gap.cik === cik && recentConcepts.has(gap.concept));
  const gaps = recentGaps.map((gap) => {
    const concept = concepts.get(gap.concept);
    const available = availableQuarters(concept);
    const cadence = reportingCadence(concept);
    const twin = twinOf(gap.concept);
    const twinAvailable = twin ? availableQuarters(concepts.get(twin)) : new Set<string>();
    const recentQuarters = gap.missingQuarters.filter((quarter) => quarter >= RECENT_QUARTER);
    const recoverableQuarters = recentQuarters.filter((quarter) => available.has(quarter));
    const aliasQuarters = recentQuarters.filter((quarter) => !available.has(quarter) && twinAvailable.has(quarter));
    const unavailableQuarters = recentQuarters.filter((quarter) => !available.has(quarter) && !twinAvailable.has(quarter));
    const lastAvailable = [...available].sort().pop() ?? null;
    const status: GapDiagnosisStatus = recoverableQuarters.length
      ? "recoverable"
      : aliasQuarters.length ? "alias_candidate" : "unavailable";
    const reason = status === "recoverable"
      ? `Exact concept facts exist for ${recoverableQuarters.length} of ${recentQuarters.length} recent missing quarters; ${unavailableQuarters.length} remain unavailable.`
      : status === "alias_candidate"
        ? `No exact fact exists, but the Current/Noncurrent twin ${twin} covers ${aliasQuarters.length} of ${recentQuarters.length} recent missing quarters; review values and taxonomy before any merge.`
        : "No exact or Current/Noncurrent twin fact exists for these quarters in current companyfacts; repeated download cannot restore them.";
    return {
      concept: gap.concept,
      status,
      lastAvailable,
      recentQuarters,
      recoverableQuarters,
      aliasQuarters,
      unavailableQuarters,
      ...cadence,
      reason,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    sourceGapGeneratedAt: gapAnalysis.generatedAt,
    sourceFactsSha256,
    cik,
    summary: {
      recentErrors: recentIssues.filter((issue) => issue.severity === "error").length,
      cadenceExpectedIssues: recentIssues.filter((issue) => issue.type === "cadence_expected_gap").length,
      concepts: gaps.length,
      missingQuarters: gaps.reduce((total, gap) => total + gap.recentQuarters.length, 0),
      recoverableQuarters: gaps.reduce((total, gap) => total + gap.recoverableQuarters.length, 0),
      aliasQuarters: gaps.reduce((total, gap) => total + gap.aliasQuarters.length, 0),
      unavailableQuarters: gaps.reduce((total, gap) => total + gap.unavailableQuarters.length, 0),
      annualOnlyConcepts: gaps.filter((gap) => gap.cadence === "annual_only").length,
      annualOnlyQuarters: gaps.filter((gap) => gap.cadence === "annual_only").reduce((total, gap) => total + gap.recentQuarters.length, 0),
      quarterlyReviewConcepts: gaps.filter((gap) => gap.cadence !== "annual_only").length,
      quarterlyReviewQuarters: gaps.filter((gap) => gap.cadence !== "annual_only").reduce((total, gap) => total + gap.recentQuarters.length, 0),
    },
    gaps,
  };
}
