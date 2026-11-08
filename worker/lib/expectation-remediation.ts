import { evidenceInSource, type ExpectationStatement } from "./expectations";

export interface ExpectationRemediationChange {
  kind: "normalize_revenue" | "split_margin" | "add_tax_rate";
  basis: "gaap" | "non_gaap" | "reported";
  reason: string;
}

export function remediateExpectationStatements(
  statements: ExpectationStatement[],
  sourceText: string,
): { statements: ExpectationStatement[]; changes: ExpectationRemediationChange[] } {
  const output: ExpectationStatement[] = [];
  const changes: ExpectationRemediationChange[] = [];
  for (const statement of statements) {
    if (/^Revenue is expected to be /i.test(statement.metricRaw)
      && ((statement.qualifier === "point" && statement.toleranceUnit === "same_unit") || statement.basis !== "reported")) {
      output.push({
        ...statement,
        scopeRaw: statement.scopeRaw.startsWith("Consolidated revenue,") ? statement.scopeRaw : `Consolidated revenue, ${statement.scopeRaw}`,
        qualifier: "plus_minus",
        toleranceUnit: "percent",
        basis: "reported",
      });
      changes.push({ kind: "normalize_revenue", basis: "reported", reason: "Revenue tolerance is explicitly expressed as plus or minus a percentage" });
      continue;
    }
    if (/GAAP and non-GAAP gross margins/i.test(statement.metricRaw)) {
      for (const basis of ["gaap", "non_gaap"] as const) {
        output.push({
          ...statement,
          metricRaw: `${basis === "gaap" ? "GAAP" : "Non-GAAP"} gross margins are expected to be ${statement.valuePoint}%, plus or minus ${statement.tolerance} basis points.`,
          metric: "margin",
          scopeRaw: `${basis === "gaap" ? "GAAP" : "Non-GAAP"} gross margins, ${statement.scopeRaw}`,
          qualifier: "plus_minus",
          unit: "percent",
          basis,
        });
      }
      changes.push({ kind: "split_margin", basis: "gaap", reason: "Combined GAAP/non-GAAP margin evidence requires separate accounting bases" });
      changes.push({ kind: "split_margin", basis: "non_gaap", reason: "Combined GAAP/non-GAAP margin evidence requires separate accounting bases" });
      continue;
    }
    output.push(statement);
  }

  if (!output.some((statement) => statement.metric === "tax_rate")) {
    const match = sourceText.match(/GAAP and non-GAAP tax rates[\s\S]{0,200}?(\d+(?:\.\d+)?)(?:\s*(?:%|percent))?\s*(?:to|and|[-–—−])\s*(\d+(?:\.\d+)?)\s*(?:%|percent)\s*[.,;]/i);
    if (match) {
      const evidence = match[0];
      if (!evidenceInSource(evidence, sourceText)) throw new Error("Tax-rate evidence is not contiguous source text");
      const low = Number(match[1]);
      const high = Number(match[2]);
      for (const basis of ["gaap", "non_gaap"] as const) {
        output.push({
          kind: "guidance",
          metricRaw: `${basis === "gaap" ? "GAAP" : "Non-GAAP"} tax rates are expected to be ${low}% to ${high}%.`,
          metric: "tax_rate",
          scopeRaw: `${basis === "gaap" ? "GAAP" : "Non-GAAP"} tax rates, full year fiscal 2027`,
          periodRaw: "full year fiscal 2027",
          comparisonRaw: null,
          qualifier: "range",
          valueLow: low,
          valueHigh: high,
          valuePoint: null,
          tolerance: null,
          toleranceUnit: null,
          valueText: null,
          unit: "percent",
          basis,
          currencyBasis: "reported",
          revision: "unclear",
          previousLow: null,
          previousHigh: null,
          previousPoint: null,
          previousGuidanceDateRaw: null,
          assumptionRaw: null,
          sourceSection: "Outlook",
          evidence,
        });
        changes.push({ kind: "add_tax_rate", basis, reason: "Contiguous source evidence contains the GAAP/non-GAAP tax-rate range" });
      }
    }
  }
  return { statements: output, changes };
}
