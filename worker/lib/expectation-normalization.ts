import type { ExpectationStatement } from "./expectations";
import { canonicalMetricFor } from "./expectation-canonical-metrics";
import {
  combinedGaapBasis,
  discoverExpectationStatement,
  expectationEvidenceSha256,
  expectationStatementKey,
  EXPECTATION_NORMALIZATION_VERSION,
  nonDisclosureFromEvidence,
  plusMinusFromEvidence,
  revisionFromEvidence,
  type ExpectationNormalizationContext,
  type ExpectationReviewItem,
} from "./expectation-normalization-rules";

export interface CanonicalExpectationStatement extends ExpectationStatement {
  canonicalMetric: string;
}

export const EXPECTATION_NUMERIC_CHANGE_FIELDS = ["qualifier", "valueLow", "valueHigh", "valuePoint", "tolerance", "toleranceUnit", "unit"] as const;
export const EXPECTATION_NUMERIC_CHANGE_SEMANTICS = "numericChange=true when qualifier, valueLow, valueHigh, valuePoint, tolerance, toleranceUnit or unit changes";

export interface ExpectationNormalizationChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ExpectationNormalizationAudit extends ExpectationNormalizationContext {
  statementKey: string;
  ruleId: string;
  normalizationVersion: string;
  evidenceSha256: string;
  numericChange: boolean;
  changes: ExpectationNormalizationChange[];
  beforeStatement?: ExpectationStatement;
  afterStatement?: ExpectationStatement | ExpectationStatement[];
  afterStatementKeys: string[];
}

export function normalizeExpectationStatement(
  statement: ExpectationStatement,
  context: ExpectationNormalizationContext,
): { statements: CanonicalExpectationStatement[]; audit: ExpectationNormalizationAudit[]; review: ExpectationReviewItem[] } {
  const originalKey = expectationStatementKey(statement);
  const evidenceSha256 = expectationEvidenceSha256(statement);
  let working = { ...statement };
  const audit: ExpectationNormalizationAudit[] = [];
  const resolved = new Set<string>();
  const review = discoverExpectationStatement(statement, context);
  const apply = (ruleId: string, updates: Record<string, unknown>) => {
    const beforeStatement = { ...working };
    const changes = Object.entries(updates).filter(([field, value]) => working[field as keyof ExpectationStatement] !== value).map(([field, after]) => ({
      field,
      before: working[field as keyof ExpectationStatement],
      after,
    }));
    if (!changes.length) return;
    working = { ...working, ...updates };
    audit.push({
      ...context,
      statementKey: expectationStatementKey(beforeStatement),
      ruleId,
      normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
      evidenceSha256,
      numericChange: changes.some((change) => EXPECTATION_NUMERIC_CHANGE_FIELDS.includes(change.field as typeof EXPECTATION_NUMERIC_CHANGE_FIELDS[number])),
      changes,
      beforeStatement,
      afterStatement: { ...working },
      afterStatementKeys: [expectationStatementKey(working)],
    });
  };

  const plusMinus = plusMinusFromEvidence(statement);
  if (plusMinus && (statement.qualifier === "point" || statement.qualifier === "approximately") && statement.valuePoint !== null) {
    if (statement.tolerance !== null && statement.tolerance !== plusMinus.tolerance) {
      review.push({
        ...context,
        statementKey: originalKey,
        category: "qualifier_evidence",
        ruleId: "REVIEW_TOLERANCE_CONFLICT",
        detail: `Model tolerance ${statement.tolerance} differs from evidence tolerance ${plusMinus.tolerance}`,
        evidenceSha256,
      });
    } else {
      apply("GENERIC_PLUS_MINUS_FROM_EVIDENCE", { qualifier: "plus_minus", tolerance: plusMinus.tolerance, toleranceUnit: plusMinus.unit });
      resolved.add("DISCOVER_PLUS_MINUS");
    }
  }

  const revision = revisionFromEvidence(statement);
  if (statement.revision === "unclear" && revision) {
    apply("GENERIC_REVISION_FROM_EVIDENCE", { revision });
    resolved.add("DISCOVER_REVISION_LANGUAGE");
  }

  const numericValues = [statement.valueLow, statement.valueHigh, statement.valuePoint, statement.tolerance, statement.previousLow, statement.previousHigh, statement.previousPoint]
    .filter((value) => typeof value === "number");
  if (statement.qualifier !== "not_provided" && nonDisclosureFromEvidence(statement) && numericValues.length === 0) {
    apply("GENERIC_NON_DISCLOSURE_FROM_EVIDENCE", { kind: "non_disclosure", qualifier: "not_provided", revision: "not_provided" });
    resolved.add("DISCOVER_NON_DISCLOSURE");
  }

  let normalized: ExpectationStatement[] = [working];
  const metricRawCombined = /\bGAAP\s+and\s+non-GAAP\b/i.test(statement.metricRaw);
  if (combinedGaapBasis(statement)) {
    if (!metricRawCombined && (statement.basis === "gaap" || statement.basis === "non_gaap")) {
      resolved.add("DISCOVER_COMBINED_BASIS");
    } else if (metricRawCombined && !/respectively/i.test(statement.evidence)) {
      normalized = (["gaap", "non_gaap"] as const).map((basis) => ({ ...working, basis }));
      audit.push({
        ...context,
        statementKey: expectationStatementKey(working),
        ruleId: "GENERIC_SPLIT_COMBINED_BASIS",
        normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
        evidenceSha256,
        numericChange: false,
        changes: [{ field: "basis", before: working.basis, after: ["gaap", "non_gaap"] }],
        beforeStatement: { ...working },
        afterStatement: normalized.map((item) => ({ ...item })),
        afterStatementKeys: normalized.map(expectationStatementKey),
      });
      resolved.add("DISCOVER_COMBINED_BASIS");
    } else {
      review.push({
        ...context,
        statementKey: originalKey,
        category: "combined_basis",
        ruleId: "REVIEW_COMBINED_BASIS_VALUES",
        detail: "Combined bases require explicit per-basis values before splitting",
        evidenceSha256,
      });
    }
  }

  const statements = normalized.map((item) => {
    const alias = canonicalMetricFor(item, context);
    const canonical = { ...item, canonicalMetric: alias.canonicalMetric };
    if (alias.aliasRuleId) {
      audit.push({
        ...context,
        statementKey: expectationStatementKey(item),
        ruleId: alias.aliasRuleId,
        normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
        evidenceSha256,
        numericChange: false,
        changes: [{ field: "canonicalMetric", before: null, after: alias.canonicalMetric }],
        afterStatementKeys: [expectationStatementKey(item)],
      });
    }
    if (alias.canonicalMetric === "other.unmapped") {
      review.push({
        ...context,
        statementKey: expectationStatementKey(item),
        category: "metric_alias",
        ruleId: "REVIEW_UNMAPPED_METRIC",
        detail: `No reviewed canonical alias for ${item.metricRaw}`,
        evidenceSha256,
      });
    }
    return canonical;
  });

  return { statements, audit, review: review.filter((item) => !resolved.has(item.ruleId)) };
}

export function assertExpectationNormalizationAudit(audit: ExpectationNormalizationAudit[]): void {
  for (const item of audit) {
    if (item.normalizationVersion !== EXPECTATION_NORMALIZATION_VERSION || !/^[a-f0-9]{64}$/.test(item.evidenceSha256) || !item.statementKey || !item.changes.length || !item.afterStatementKeys.length) {
      throw new Error(`Incomplete normalization audit for ${item.ruleId}`);
    }
    const hasNumericChange = item.changes.some((change) => EXPECTATION_NUMERIC_CHANGE_FIELDS.includes(change.field as typeof EXPECTATION_NUMERIC_CHANGE_FIELDS[number]));
    if (item.numericChange !== hasNumericChange) throw new Error(`numericChange semantics mismatch for ${item.ruleId}`);
    if (!item.ruleId.startsWith("ALIAS_")) {
      if (!item.beforeStatement || !item.afterStatement) throw new Error(`Missing statement snapshots for ${item.ruleId}`);
      if (expectationStatementKey(item.beforeStatement) !== item.statementKey) throw new Error(`Before-statement resolver mismatch for ${item.ruleId}`);
      const afterStatements = Array.isArray(item.afterStatement) ? item.afterStatement : [item.afterStatement];
      if (JSON.stringify(afterStatements.map(expectationStatementKey)) !== JSON.stringify(item.afterStatementKeys)) throw new Error(`After-statement resolver mismatch for ${item.ruleId}`);
    }
  }
}
