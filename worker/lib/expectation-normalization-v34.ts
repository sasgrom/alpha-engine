import type { CohortResultEntry } from "./cohort-checkpoint";
import type { ExpectationStatement } from "./expectations";
import { canonicalMetricFor } from "./expectation-canonical-metrics";
import {
  EXPECTATION_NUMERIC_CHANGE_FIELDS,
  type CanonicalExpectationStatement,
  type ExpectationNormalizationAudit,
  type ExpectationNormalizationChange,
} from "./expectation-normalization";
import {
  expectationEvidenceSha256,
  expectationStatementKey,
  plusMinusFromEvidence,
  type ExpectationNormalizationContext,
  type ExpectationReviewItem,
} from "./expectation-normalization-rules";
import aliasFile from "../../research/expectation-metric-alias-salvage-v1.json";

export const EXPECTATION_NORMALIZATION_V34 = "expectation-normalization-v3.4";
export const EXPECTATION_LEGACY_CUTOFF = "2024-11-09";

type Entry = CohortResultEntry & { statements: CanonicalExpectationStatement[] };
type Context = ExpectationNormalizationContext & { reportDate?: string | null };
export interface V34ReviewItem extends ExpectationReviewItem { blocking?: boolean }
export interface V34Audit extends ExpectationNormalizationAudit { periodEnd?: string | null }

interface AliasDefinition { ruleId: string; pattern: string; canonicalMetric: string; metric?: string; scopeFromMetricRaw?: boolean; basis?: string }
const SALVAGE_ALIASES = (aliasFile.aliases as AliasDefinition[]).map((alias) => ({ ...alias, regex: new RegExp(alias.pattern, "i") }));
const principalFields = ["valueLow", "valueHigh", "valuePoint"] as const;
const numericFields = [...principalFields, "previousLow", "previousHigh", "previousPoint"] as const;

function changesBetween(before: ExpectationStatement, after: ExpectationStatement): ExpectationNormalizationChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after), "canonicalMetric"])];
  return keys.filter((key) => JSON.stringify((before as any)[key]) !== JSON.stringify((after as any)[key])).map((field) => ({ field, before: (before as any)[field] ?? null, after: (after as any)[field] ?? null }));
}

function auditRecord(options: {
  context: Context;
  ruleId: string;
  before: ExpectationStatement;
  after: ExpectationStatement[];
  changes?: ExpectationNormalizationChange[];
  periodEnd?: string | null;
}): V34Audit {
  const afterStatement = options.after.map((statement) => ({ ...statement }));
  return {
    ...options.context,
    statementKey: expectationStatementKey(options.before),
    ruleId: options.ruleId,
    normalizationVersion: EXPECTATION_NORMALIZATION_V34,
    evidenceSha256: expectationEvidenceSha256(options.before),
    numericChange: false,
    changes: options.changes ?? (options.after.length === 1 ? changesBetween(options.before, options.after[0]) : [{ field: "statementCount", before: 1, after: options.after.length }]),
    beforeStatement: { ...options.before },
    afterStatement,
    afterStatementKeys: options.after.map(expectationStatementKey),
    periodEnd: options.periodEnd,
  };
}

function finalizeAudit(audit: V34Audit): V34Audit {
  audit.numericChange = audit.changes.some((change) => EXPECTATION_NUMERIC_CHANGE_FIELDS.includes(change.field as typeof EXPECTATION_NUMERIC_CHANGE_FIELDS[number]));
  return audit;
}

function scaleAmounts(evidence: string): { unit: "usd_millions" | "usd_billions"; values: number[] } | null {
  const hasMillion = /\bmillions?\b/i.test(evidence);
  const hasBillion = /\bbillions?\b/i.test(evidence);
  if (hasMillion === hasBillion) return null;
  const unit = hasMillion ? "usd_millions" : "usd_billions";
  const regex = /(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s*(?:millions?|billions?)\b/gi;
  const values = [];
  for (const match of evidence.matchAll(regex)) values.push(Number(match[1].replaceAll(",", "")));
  return values.length ? { unit, values } : null;
}

export function reconcileV34Scale(statement: CanonicalExpectationStatement): CanonicalExpectationStatement | null {
  if (statement.unit !== "usd_millions" && statement.unit !== "usd_billions") return null;
  const evidence = scaleAmounts(statement.evidence);
  if (!evidence || evidence.unit === statement.unit) return null;
  const factor = statement.unit === "usd_billions" ? 1000 : 0.001;
  const matches = numericFields.some((field) => {
    const value = statement[field];
    return typeof value === "number" && evidence.values.some((candidate) => Math.abs(value * factor - candidate) <= Math.max(1, Math.abs(candidate)) * 1e-9);
  });
  if (!matches) return null;
  const next = { ...statement, unit: evidence.unit } as CanonicalExpectationStatement;
  for (const field of numericFields) {
    const value = statement[field];
    if (typeof value === "number") (next as any)[field] = Number((value * factor).toPrecision(12));
  }
  if (statement.tolerance !== null && statement.toleranceUnit === statement.unit) {
    next.tolerance = Number((statement.tolerance * factor).toPrecision(12));
    next.toleranceUnit = evidence.unit;
  }
  return next;
}

function respectivelyValues(statement: CanonicalExpectationStatement): { first: number; second: number; unit?: string } | null {
  const clause = statement.evidence.split(/\brespectively\b/i)[0];
  const percent = [...clause.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi)];
  if (percent.length >= 2) return { first: Number(percent.at(-2)![1]), second: Number(percent.at(-1)![1]), unit: "percent" };
  const scaled = [...clause.matchAll(/(-?\d+(?:\.\d+)?)\s*(millions?|billions?)\b/gi)];
  if (scaled.length >= 2) {
    const unit = /million/i.test(scaled.at(-1)![2]) ? "usd_millions" : "usd_billions";
    return { first: Number(scaled.at(-2)![1]), second: Number(scaled.at(-1)![1]), unit };
  }
  const dollars = [...clause.matchAll(/\$\s*(-?\d+(?:\.\d+)?)/g)];
  if (dollars.length >= 2) return { first: Number(dollars.at(-2)![1]), second: Number(dollars.at(-1)![1]) };
  return null;
}

function splitRespectively(statement: CanonicalExpectationStatement, context: Context): CanonicalExpectationStatement[] | null {
  if (!/\bGAAP\s+and\s+non-GAAP\b/i.test(`${statement.metricRaw}\n${statement.evidence}`) || !/\brespectively\b/i.test(statement.evidence)) return null;
  const values = respectivelyValues(statement);
  if (!values) return null;
  return (["gaap", "non_gaap"] as const).map((basis, index) => {
    const next = {
      ...statement,
      basis,
      qualifier: statement.qualifier === "plus_minus" ? "plus_minus" : statement.qualifier === "point" ? "point" : "approximately",
      valueLow: null,
      valueHigh: null,
      valuePoint: index === 0 ? values.first : values.second,
      unit: values.unit ?? statement.unit,
    } as CanonicalExpectationStatement;
    return { ...next, canonicalMetric: canonicalMetricFor(next, context).canonicalMetric };
  });
}

function statementPeriodEnd(statement: ExpectationStatement, context: Context): string | null {
  const raw = statement.periodRaw.trim();
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const yearNumber = (value: string) => Number(value.length === 2 ? `20${value}` : value);
  const quarter = raw.match(/(?:Q([1-4])\s*(?:FY\s*)?|([1-4])Q\s*(?:FY\s*)?)(\d{4}|\d{2})\b/i);
  const wordQuarter = raw.match(/(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(?:FY\s*)?(\d{4}|\d{2})\b/i);
  if (quarter || wordQuarter) {
    const q = quarter?.[1] ? Number(quarter[1]) : quarter?.[2] ? Number(quarter[2]) : ({ first: 1, second: 2, third: 3, fourth: 4 } as Record<string, number>)[wordQuarter![1].toLowerCase()];
    const year = yearNumber(quarter?.[3] ?? wordQuarter![2]);
    if (q && year) return `${year}-${String(q * 3).padStart(2, "0")}-${["31", "30", "30", "31"][q - 1]}`;
  }
  const fiscal = raw.match(/(?:FY\s*|full[- ]year\s+(?:fiscal\s+)?|fiscal\s+|for\s+)?(\d{4}|\d{2})\b/i);
  if (fiscal && /FY|full[- ]year|fiscal|\bfor\b|^\s*(?:19|20)\d{2}\s*$/i.test(raw)) return `${yearNumber(fiscal[1])}-12-31`;
  const monthName = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const month = raw.match(new RegExp(`(${monthName})\\.?\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})`, "i"));
  if (month) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((name) => month[1].toLowerCase().startsWith(name));
    return `${month[3]}-${String(monthIndex + 1).padStart(2, "0")}-${String(Number(month[2])).padStart(2, "0")}`;
  }
  const monthYear = raw.match(new RegExp(`(${monthName})\\.?\\s+((?:19|20)\\d{2})`, "i"));
  if (monthYear) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((name) => monthYear[1].toLowerCase().startsWith(name));
    return new Date(Date.UTC(Number(monthYear[2]), monthIndex + 1, 0)).toISOString().slice(0, 10);
  }
  return context.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(context.reportDate) ? context.reportDate : null;
}

function isSuspectedNoise(metricRaw: string): boolean {
  const raw = metricRaw.trim();
  return /^(?:DCF|profit|approximately\s+\$?[\d.,]+\s*(?:million|billion))$/i.test(raw) || raw.length > 180;
}

export interface V34Summary {
  scaleReconciled: number;
  combinedBasisSplits: number;
  qualifierDowngraded: number;
  qualifierRejected: number;
  legacyOther: number;
  recentUnmapped: number;
  recentSalvaged: number;
  recentResidualOther: number;
  recentResidualNoiseSuspected: number;
  unknownPeriodOther: number;
}

export function transformV34Entries(entries: Entry[], baselineReview: ExpectationReviewItem[]) {
  const outputEntries: Entry[] = [];
  const untouched: { key: string; statement: CanonicalExpectationStatement }[] = [];
  const audit: V34Audit[] = [];
  const review: V34ReviewItem[] = [];
  const summary: V34Summary = { scaleReconciled: 0, combinedBasisSplits: 0, qualifierDowngraded: 0, qualifierRejected: 0, legacyOther: 0, recentUnmapped: 0, recentSalvaged: 0, recentResidualOther: 0, recentResidualNoiseSuspected: 0, unknownPeriodOther: 0 };

  for (const entry of entries) {
    const context: Context = { ticker: entry.ticker, cik: entry.cik, accessionNo: entry.accessionNo, reportDate: entry.reportDate };
    const statements: CanonicalExpectationStatement[] = [];
    for (const original of entry.statements) {
      const originalKey = expectationStatementKey(original);
      const resolved = new Set<string>();
      let current = [original];
      let changed = false;
      let rejected = false;

      const split = splitRespectively(original, context);
      if (split) {
        current = split;
        changed = true;
        summary.combinedBasisSplits++;
        resolved.add("DISCOVER_COMBINED_BASIS").add("REVIEW_COMBINED_BASIS_VALUES");
        if (original.qualifier === "plus_minus" && original.valuePoint === null && original.tolerance !== null) resolved.add("DISCOVER_TOLERANCE_SHAPE");
        audit.push(finalizeAudit(auditRecord({ context, ruleId: "COMBINED_BASIS_SPLIT", before: original, after: split })));
      }

      const nextStatements: CanonicalExpectationStatement[] = [];
      for (let statement of current) {
        const scaled = reconcileV34Scale(statement);
        if (scaled) {
          changed = true;
          summary.scaleReconciled++;
          resolved.add("DISCOVER_UNIT_EVIDENCE_SCALE");
          audit.push(finalizeAudit(auditRecord({ context, ruleId: "SCALE_EVIDENCE_RECONCILE", before: statement, after: [scaled] })));
          statement = scaled;
        }

        const incompleteRange = statement.qualifier === "range" && (statement.valueLow === null || statement.valueHigh === null);
        const evidenceToleranceWithoutPoint = (statement.qualifier === "point" || statement.qualifier === "approximately") && statement.valuePoint === null && plusMinusFromEvidence(statement) !== null;
        const incompleteTolerance = (statement.qualifier === "plus_minus" && (statement.valuePoint === null || statement.tolerance === null)) || evidenceToleranceWithoutPoint;
        if (incompleteRange || incompleteTolerance) {
          changed = true;
          resolved.add(incompleteRange ? "DISCOVER_RANGE_SHAPE" : evidenceToleranceWithoutPoint ? "DISCOVER_PLUS_MINUS" : "DISCOVER_TOLERANCE_SHAPE");
          const hasPrincipalValue = principalFields.some((field) => statement[field] !== null);
          if (!hasPrincipalValue) {
            summary.qualifierRejected++;
            rejected = true;
            audit.push(finalizeAudit(auditRecord({
              context,
              ruleId: "QUALIFIER_DOWNGRADE",
              before: statement,
              after: [],
              changes: [{ field: "disposition", before: "incomplete_qualifier", after: "rejected_no_numeric_value" }],
            })));
            continue;
          }
          const downgraded = {
            ...statement,
            qualifier: "approximately",
            valuePoint: statement.valuePoint ?? statement.valueLow ?? statement.valueHigh,
            valueLow: null,
            valueHigh: null,
            tolerance: null,
            toleranceUnit: null,
          } as CanonicalExpectationStatement;
          summary.qualifierDowngraded++;
          audit.push(finalizeAudit(auditRecord({ context, ruleId: "QUALIFIER_DOWNGRADE", before: statement, after: [downgraded] })));
          review.push({
            ...context,
            statementKey: expectationStatementKey(downgraded),
            category: "qualifier_evidence",
            ruleId: "QUALIFIER_DOWNGRADE",
            detail: "Incomplete range or plus/minus was downgraded to approximately",
            evidenceSha256: expectationEvidenceSha256(statement),
            blocking: false,
          });
          statement = downgraded;
        }

        if (statement.revision === "unclear" && /\bcontinue to expect\b/i.test(statement.evidence)) {
          const reaffirmed = { ...statement, revision: "reaffirmed" } as CanonicalExpectationStatement;
          changed = true;
          audit.push(finalizeAudit(auditRecord({ context, ruleId: "REVISION_REAFFIRM_FROM_EVIDENCE", before: statement, after: [reaffirmed] })));
          statement = reaffirmed;
        }

        const metadataRaw = `${statement.metricRaw}\n${statement.scopeRaw}`;
        const metadataAlias = SALVAGE_ALIASES.find((alias) => alias.canonicalMetric === statement.canonicalMetric && alias.regex.test(metadataRaw) && (alias.metric || alias.basis || alias.scopeFromMetricRaw));
        if (metadataAlias) {
          const normalizedScope = statement.scopeRaw.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const normalizedPeriod = statement.periodRaw.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const scopeIsPeriod = normalizedScope === normalizedPeriod || /quarter|^\d{4}$/i.test(statement.scopeRaw.trim());
          const normalized = {
            ...statement,
            metric: metadataAlias.metric ?? statement.metric,
            scopeRaw: metadataAlias.scopeFromMetricRaw && scopeIsPeriod ? statement.metricRaw : statement.scopeRaw,
            basis: metadataAlias.basis ?? statement.basis,
          } as CanonicalExpectationStatement;
          if (JSON.stringify(normalized) !== JSON.stringify(statement)) {
            changed = true;
            audit.push(finalizeAudit(auditRecord({
              context,
              ruleId: "METRIC_ALIAS_SALVAGE",
              before: statement,
              after: [normalized],
              changes: [...changesBetween(statement, normalized), { field: "salvageRuleId", before: null, after: metadataAlias.ruleId }],
            })));
            statement = normalized;
          }
        }

        if (statement.canonicalMetric === "other.unmapped") {
          const periodEnd = statementPeriodEnd(statement, context);
          const legacy = periodEnd !== null && periodEnd < EXPECTATION_LEGACY_CUTOFF;
          if (!legacy && periodEnd) summary.recentUnmapped++;
          const raw = `${statement.metricRaw}\n${statement.scopeRaw}`;
          const salvage = legacy ? undefined : SALVAGE_ALIASES.find((alias) => alias.regex.test(raw));
          let canonicalMetric = "other";
          let ruleId = legacy ? "METRIC_OTHER_LEGACY" : "METRIC_OTHER_RESIDUAL";
          let detail = legacy ? `Legacy period end ${periodEnd}; retained as non-blocking other` : "No reviewed salvage alias; retained as non-blocking other";
          if (salvage) {
            canonicalMetric = salvage.canonicalMetric;
            ruleId = "METRIC_ALIAS_SALVAGE";
            if (periodEnd) summary.recentSalvaged++;
          } else if (legacy) {
            summary.legacyOther++;
          } else if (periodEnd) {
            summary.recentResidualOther++;
            if (isSuspectedNoise(statement.metricRaw)) summary.recentResidualNoiseSuspected++;
          } else {
            summary.unknownPeriodOther++;
          }
          const next = { ...statement, canonicalMetric };
          statement = next;
          changed = true;
          resolved.add("REVIEW_UNMAPPED_METRIC");
          audit.push(finalizeAudit(auditRecord({
            context,
            ruleId,
            before: statement,
            after: [next],
            periodEnd,
            changes: [
              { field: "canonicalMetric", before: statement.canonicalMetric, after: canonicalMetric },
              { field: "periodEnd", before: null, after: periodEnd },
              ...(salvage ? [{ field: "salvageRuleId", before: null, after: salvage.ruleId }] : []),
            ],
          })));
          if (!salvage) {
            review.push({ ...context, statementKey: expectationStatementKey(next), category: "metric_alias", ruleId, detail, evidenceSha256: expectationEvidenceSha256(statement), blocking: false });
          }
        }
        nextStatements.push(statement);
      }

      if (!changed) untouched.push({ key: `${entry.cik}|${entry.accessionNo}|${entry.sourceId}|${entry.containerId}`, statement: original });
      statements.push(...nextStatements);
      const originalReviews = baselineReview.filter((item) => item.cik === entry.cik && item.accessionNo === entry.accessionNo && item.statementKey === originalKey);
      if (!rejected) {
        for (const item of originalReviews) {
          if (!resolved.has(item.ruleId)) review.push(item);
        }
      }
    }
    outputEntries.push({ ...entry, statements });
  }
  return { entries: outputEntries, untouched, audit, review, summary };
}

export function assertV34Audit(audit: V34Audit[]): void {
  for (const item of audit) {
    if (item.normalizationVersion !== EXPECTATION_NORMALIZATION_V34 || !item.beforeStatement || !item.afterStatement || !item.changes.length || !/^[a-f0-9]{64}$/.test(item.evidenceSha256)) {
      throw new Error(`Incomplete v3.4 audit for ${item.ruleId}`);
    }
    if (!item.afterStatement.length && !(item.ruleId === "QUALIFIER_DOWNGRADE" && item.afterStatementKeys.length === 0)) throw new Error(`Unexpected empty v3.4 output for ${item.ruleId}`);
    if (item.afterStatement.length !== item.afterStatementKeys.length) throw new Error(`Audit resolver mismatch for ${item.ruleId}`);
    const numeric = item.changes.some((change) => EXPECTATION_NUMERIC_CHANGE_FIELDS.includes(change.field as typeof EXPECTATION_NUMERIC_CHANGE_FIELDS[number]));
    if (numeric !== item.numericChange) throw new Error(`numericChange mismatch for ${item.ruleId}`);
  }
}
