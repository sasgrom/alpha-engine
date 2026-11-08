import { evidenceInSource, type ExpectationStatement } from "./expectations";
import type { GoldStatement } from "./expectations-benchmark";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const numberPattern = (value: number) => {
  const variants = new Set<string>([String(value)]);
  if (Number.isInteger(value)) variants.add(value.toFixed(1));
  variants.add(value.toFixed(1));
  variants.add(value.toFixed(2));
  return new RegExp(`(?<![\\d.])${[...variants].map((item) => item.replace(".", "\\.")).join("|")}(?![\\d.])`, "i");
};

export function includesNumber(text: string, value: number | undefined): boolean {
  return value === undefined || numberPattern(value).test(text);
}

export function candidateBlocks(sourceText: string): string[] {
  const paragraphs = sourceText.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
  const sentences = sourceText.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const windows: string[] = [];
  for (const match of sourceText.matchAll(/\d+(?:\.\d+)?/g)) {
    const start = Math.max(0, match.index - 2000);
    const end = Math.min(sourceText.length, match.index + match[0].length + 2000);
    windows.push(sourceText.slice(start, end).trim());
  }
  return [...paragraphs, ...sentences, ...windows]
    .map((value) => value.replace(/^\[SOURCE_ID [^\]]+\]\s*/, ""))
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a.length - b.length);
}

export function extractGoldStatementsFromSource(
  required: GoldStatement[],
  sourceText: string,
): { statements: ExpectationStatement[]; missing: string[] } {
  const statements: ExpectationStatement[] = [];
  const missing: string[] = [];
  const candidates = candidateBlocks(sourceText);
  for (const gold of required) {
    const metric = gold.metric;
    const scopeAny = gold.scopeAny.flatMap((value) => {
      const normalized = normalize(value);
      if (normalized === "adjusted diluted eps") return [normalized, "adjusted diluted earnings per share", "adjusted earnings per share"];
      if (normalized === "adjusted eps") return [normalized, "adjusted earnings per share"];
      if (normalized === "adjusted net earnings") return [normalized, "adjusted net income"];
      return [normalized];
    });
    const periodAny = gold.periodAny.map(normalize);
    const fullText = normalize(sourceText);
    const found = candidates.find((candidate) => {
      if (!scopeAny.some((value) => fullText.includes(value))) return false;
      if (!periodAny.some((value) => fullText.includes(value))) return false;
      if (!includesNumber(candidate, gold.low) || !includesNumber(candidate, gold.high) || !includesNumber(candidate, gold.point)) return false;
      if (!includesNumber(candidate, gold.tolerance)) return false;
      if (!includesNumber(candidate, gold.previousLow) || !includesNumber(candidate, gold.previousHigh) || !includesNumber(candidate, gold.previousPoint)) return false;
      return true;
    });
    if (!found) {
      missing.push(`${metric} · ${gold.scopeAny[0]} · ${gold.periodAny[0]}`);
      continue;
    }
    if (!evidenceInSource(found, sourceText)) throw new Error(`${metric}: evidence is not contiguous source text`);
    statements.push({
      kind: gold.kind ?? "guidance",
      metricRaw: `${metric} · ${gold.scopeAny[0]} · ${gold.periodAny[0]}`,
      metric,
      scopeRaw: gold.scopeAny[0],
      periodRaw: gold.periodAny[0],
      comparisonRaw: null,
      qualifier: gold.qualifier,
      valueLow: gold.low ?? null,
      valueHigh: gold.high ?? null,
      valuePoint: gold.point ?? null,
      tolerance: gold.tolerance ?? null,
      toleranceUnit: gold.toleranceUnit ?? null,
      valueText: null,
      unit: gold.unit ?? "other",
      basis: gold.basis ?? "unclear",
      currencyBasis: gold.currencyBasis ?? "unclear",
      revision: gold.revision ?? "unclear",
      previousLow: gold.previousLow ?? null,
      previousHigh: gold.previousHigh ?? null,
      previousPoint: gold.previousPoint ?? null,
      previousGuidanceDateRaw: null,
      assumptionRaw: null,
      sourceSection: "Outlook",
      evidence: found,
    });
  }
  return { statements, missing };
}
