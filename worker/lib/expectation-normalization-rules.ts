import { createHash } from "node:crypto";
import type { ExpectationStatement } from "./expectations";

export const EXPECTATION_NORMALIZATION_VERSION = "expectation-normalization-v2";
export const EXPECTATION_DEVELOPMENT_TICKERS = ["NVDA", "META", "AMZN", "JPM", "WMT"] as const;
export const EXPECTATION_HOLDOUT_TICKERS = ["PFE", "UNH", "MSFT", "DAL", "RCL", "DASH", "NKE", "T"] as const;

export interface ExpectationNormalizationContext {
  ticker: string;
  cik: number;
  accessionNo: string;
  industry?: string;
}

export interface ExpectationReviewItem extends ExpectationNormalizationContext {
  statementKey: string;
  category: "value_unit_scale" | "qualifier_evidence" | "combined_basis" | "revision_language" | "non_disclosure" | "metric_alias" | "ambiguous";
  ruleId: string;
  detail: string;
  evidenceSha256: string;
}

export function expectationStatementKey(statement: ExpectationStatement): string {
  return JSON.stringify([
    statement.metricRaw, statement.metric, statement.scopeRaw, statement.periodRaw, statement.basis,
    statement.qualifier, statement.valueLow, statement.valueHigh, statement.valuePoint, statement.tolerance,
    statement.toleranceUnit, statement.unit, statement.revision,
  ]);
}

export function expectationEvidenceSha256(statement: ExpectationStatement): string {
  return createHash("sha256").update(statement.evidence).digest("hex");
}

function metricAnchor(statement: ExpectationStatement): RegExp | null {
  const raw = statement.metricRaw.toLowerCase();
  const anchors: [string, RegExp][] = [
    ["gross margin", /gross margins?/i],
    ["operating margin", /operating margins?/i],
    ["equity ratio", /equity ratio/i],
    ["tax rate", /tax rates?/i],
    ["revenue", /revenue|net sales/i],
    ["net sales", /net sales/i],
    ["operating income", /operating income/i],
    ["net income", /net income|net earnings/i],
    ["eps", /EPS|earnings per share/i],
    ["capex", /capex|capital expenditures/i],
  ];
  return anchors.find(([anchor]) => raw.includes(anchor))?.[1] ?? null;
}

function clauseNumberIndex(clause: string, value: number): number {
  const variants = new Set([String(value), value.toFixed(1), value.toFixed(2)]);
  for (const variant of variants) {
    const index = clause.search(new RegExp(`(?<![\\d.])${variant.replace(".", "\\.")}(?![\\d.])`));
    if (index >= 0) return index;
  }
  return -1;
}

export function plusMinusFromEvidence(statement: ExpectationStatement): { tolerance: number; unit: "percent" | "basis_points" } | null {
  const anchor = metricAnchor(statement);
  if (!anchor) return null;
  const clauses = statement.evidence.split(/[.;](?=\s|$)|\bcompared to\b|\bas well as\b/i);
  for (const clause of clauses) {
    const match = clause.match(/plus or minus\s+(\d+(?:\.\d+)?)\s*(%|percentage points?|basis points?|percent\b)/i);
    if (!match || !anchor.test(clause)) continue;
    if (statement.valuePoint !== null) {
      const valueIndex = clauseNumberIndex(clause, statement.valuePoint);
      if (valueIndex < 0 || valueIndex > (match.index ?? 0)) continue;
    }
    const basisPoints = /points?/i.test(match[2]);
    return { tolerance: Number(match[1]) * (basisPoints && /percentage/i.test(match[2]) ? 100 : 1), unit: basisPoints ? "basis_points" : "percent" };
  }
  return null;
}

export function combinedGaapBasis(statement: ExpectationStatement): boolean {
  return /\bGAAP\s+and\s+non-GAAP\b/i.test(`${statement.metricRaw}\n${statement.evidence}`);
}

export function revisionFromEvidence(statement: ExpectationStatement): ExpectationStatement["revision"] | null {
  const evidence = statement.evidence;
  if (/reaffirm(?:ed|s)?(?:\s+\w+){0,5}\s+(?:guidance|outlook)|(?:guidance|outlook)\s+(?:was|is|has been)?\s*reaffirmed/i.test(evidence)) return "reaffirmed";
  if (/narrow(?:ed|ing)(?:\s+\w+){0,5}\s+(?:guidance|outlook|range)|(?:guidance|outlook|range)\s+(?:was|is|has been)?\s*narrowed/i.test(evidence)) return "narrowed";
  if (/widen(?:ed|ing)(?:\s+\w+){0,5}\s+(?:guidance|outlook|range)|(?:guidance|outlook|range)\s+(?:was|is|has been)?\s*widened/i.test(evidence)) return "widened";
  if (/(?:raised|increased)(?:\s+\w+){0,5}\s+(?:guidance|outlook)|(?:guidance|outlook)\s+(?:was|is|has been)?\s*(?:raised|increased)/i.test(evidence)) return "raised";
  if (/(?:lowered|decreased|cut)(?:\s+\w+){0,5}\s+(?:guidance|outlook)|(?:guidance|outlook)\s+(?:was|is|has been)?\s*(?:lowered|decreased|cut)/i.test(evidence)) return "lowered";
  return null;
}

export function nonDisclosureFromEvidence(statement: ExpectationStatement): boolean {
  return /do not (?:currently )?provide (?:guidance|an outlook)|not providing (?:guidance|an outlook)|decline[sd]? to provide (?:guidance|an outlook)|withdraw(?:s|n)?\s+(?:its|our|the)?\s*(?:guidance|outlook)|no (?:forward-looking )?guidance (?:is|will be) provided/i.test(statement.evidence);
}

function numericValues(statement: ExpectationStatement): number[] {
  return [statement.valueLow, statement.valueHigh, statement.valuePoint, statement.tolerance, statement.previousLow, statement.previousHigh, statement.previousPoint]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function discoverExpectationStatement(
  statement: ExpectationStatement,
  context: ExpectationNormalizationContext,
): ExpectationReviewItem[] {
  const items: ExpectationReviewItem[] = [];
  const base = { ...context, statementKey: expectationStatementKey(statement), evidenceSha256: expectationEvidenceSha256(statement) };
  const add = (category: ExpectationReviewItem["category"], ruleId: string, detail: string) => items.push({ ...base, category, ruleId, detail });
  const values = numericValues(statement);
  const hasMillion = /\b(?:USD\s*)?millions?\b|\$\s*[\d.,]+\s*million\b/i.test(statement.evidence);
  const hasBillion = /\b(?:USD\s*)?billions?\b|\$\s*[\d.,]+\s*billion\b/i.test(statement.evidence);
  if ((statement.unit === "usd_billions" && hasMillion && !hasBillion) || (statement.unit === "usd_millions" && hasBillion && !hasMillion)) {
    add("value_unit_scale", "DISCOVER_UNIT_EVIDENCE_SCALE", `${statement.unit} conflicts with the explicit evidence scale`);
  }
  if (statement.valueLow !== null && statement.valueHigh !== null && statement.valueLow > statement.valueHigh) {
    add("value_unit_scale", "DISCOVER_REVERSED_RANGE", "valueLow is greater than valueHigh");
  }
  if (statement.unit === "percent" && values.some((value) => Math.abs(value) > 1000)) {
    add("value_unit_scale", "DISCOVER_PERCENT_SCALE", "A percent value exceeds 1,000 and requires scale review");
  }
  if ((statement.qualifier === "point" || statement.qualifier === "approximately") && plusMinusFromEvidence(statement)) {
    add("qualifier_evidence", "DISCOVER_PLUS_MINUS", "Evidence expresses plus/minus tolerance while the qualifier is point or approximately");
  }
  if (statement.qualifier === "range" && (statement.valueLow === null || statement.valueHigh === null)) {
    add("qualifier_evidence", "DISCOVER_RANGE_SHAPE", "Range qualifier lacks a complete low/high pair");
  }
  if (statement.qualifier === "plus_minus" && (statement.valuePoint === null || statement.tolerance === null)) {
    add("qualifier_evidence", "DISCOVER_TOLERANCE_SHAPE", "Plus/minus qualifier lacks a point or tolerance");
  }
  if (combinedGaapBasis(statement)) add("combined_basis", "DISCOVER_COMBINED_BASIS", "GAAP and non-GAAP bases are combined in one statement");
  if (statement.revision === "unclear" && revisionFromEvidence(statement)) {
    add("revision_language", "DISCOVER_REVISION_LANGUAGE", "Evidence contains guidance-vintage revision language");
  }
  if (statement.qualifier !== "not_provided" && nonDisclosureFromEvidence(statement)) {
    add("non_disclosure", "DISCOVER_NON_DISCLOSURE", "Evidence contains an explicit non-disclosure phrase");
  }
  return items;
}
