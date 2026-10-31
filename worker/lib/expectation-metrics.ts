import type { ExpectationStatement } from "./expectations";

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Exact semantic compatibility is deliberately conservative; aliases need an explicit reviewed map. */
export function expectationPairCompatible(guidance: ExpectationStatement, actual: ExpectationStatement): boolean {
  if (guidance.metric !== actual.metric || norm(guidance.metricRaw) !== norm(actual.metricRaw)) return false;
  if (norm(guidance.scopeRaw) !== norm(actual.scopeRaw) || norm(guidance.periodRaw) !== norm(actual.periodRaw)) return false;
  if (guidance.unit !== actual.unit || guidance.basis !== actual.basis || guidance.currencyBasis !== actual.currencyBasis) return false;
  return !["unclear", "mixed"].includes(guidance.basis) && !["unclear", "mixed"].includes(actual.basis) && guidance.currencyBasis !== "unclear" && actual.currencyBasis !== "unclear";
}

export function guidanceCenter(statement: ExpectationStatement): number | null {
  if (statement.qualifier === "range" && statement.valueLow !== null && statement.valueHigh !== null) return (statement.valueLow + statement.valueHigh) / 2;
  if (["point", "approximately", "plus_minus"].includes(statement.qualifier) && statement.valuePoint !== null) return statement.valuePoint;
  return null;
}

function previousCenter(statement: ExpectationStatement): number | null {
  if (statement.previousLow !== null && statement.previousHigh !== null) return (statement.previousLow + statement.previousHigh) / 2;
  return statement.previousPoint;
}

function scale(value: number, explicit?: number): number | null {
  const result = explicit ?? Math.abs(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function guidanceRevision(statement: ExpectationStatement, denominatorScale?: number): number | null {
  const current = guidanceCenter(statement), previous = previousCenter(statement);
  if (current === null || previous === null) return null;
  const divisor = scale(previous, denominatorScale);
  return divisor === null ? null : (current - previous) / divisor;
}

export function guidanceWidth(statement: ExpectationStatement, denominatorScale?: number): number | null {
  if (statement.qualifier !== "range" || statement.valueLow === null || statement.valueHigh === null) return null;
  const center = guidanceCenter(statement);
  if (center === null) return null;
  const divisor = scale(center, denominatorScale);
  return divisor === null ? null : (statement.valueHigh - statement.valueLow) / divisor;
}

export function guidanceOutcome(actual: number, statement: ExpectationStatement): "below_range" | "within_range" | "above_range" | "below_floor" | "above_floor" | "above_ceiling" | "below_ceiling" | "point_comparison" | null {
  if (!Number.isFinite(actual)) return null;
  if (statement.qualifier === "range" && statement.valueLow !== null && statement.valueHigh !== null) {
    return actual < statement.valueLow ? "below_range" : actual > statement.valueHigh ? "above_range" : "within_range";
  }
  if (statement.qualifier === "at_least" && statement.valueLow !== null) return actual < statement.valueLow ? "below_floor" : "above_floor";
  if (statement.qualifier === "at_most" && statement.valueHigh !== null) return actual > statement.valueHigh ? "above_ceiling" : "below_ceiling";
  return guidanceCenter(statement) === null ? null : "point_comparison";
}

export function guidanceSurprise(actual: number, statement: ExpectationStatement, denominatorScale?: number): number | null {
  let benchmark: number | null = null;
  if (statement.qualifier === "at_least") benchmark = statement.valueLow;
  else if (statement.qualifier === "at_most") benchmark = statement.valueHigh;
  else benchmark = guidanceCenter(statement);
  if (benchmark === null) return null;
  const divisor = scale(benchmark, denominatorScale);
  return divisor === null ? null : (actual - benchmark) / divisor;
}

export function reactionZ(car: number, expectedMoveReturn: number): number | null {
  if (![car, expectedMoveReturn].every(Number.isFinite) || expectedMoveReturn <= 0) return null;
  return car / expectedMoveReturn;
}

export function reversal(initialCar: number, subsequentCar: number): number | null {
  if (![initialCar, subsequentCar].every(Number.isFinite) || initialCar === 0) return null;
  return -Math.sign(initialCar) * subsequentCar;
}

export interface CredibilityRow { signedError: number; hit: boolean }
export function guidanceCredibility(rows: CredibilityRow[], minimumHistory = 8, priorWeight = 4, priorMean = 0) {
  const valid = rows.filter((row) => Number.isFinite(row.signedError) && typeof row.hit === "boolean");
  const n = valid.length;
  const usable = n >= minimumHistory && Number.isFinite(priorWeight) && priorWeight >= 0 && Number.isFinite(priorMean);
  const sum = valid.reduce((total, row) => total + row.signedError, 0);
  return {
    n,
    usable,
    rawMeanError: n ? sum / n : null,
    hitRate: n ? valid.filter((row) => row.hit).length / n : null,
    shrunkMeanError: usable ? (sum + priorWeight * priorMean) / (n + priorWeight) : null,
    priorWeight,
  };
}
