import { describe, expect, it } from "vitest";
import { auditStatementView, factorReadiness } from "./research-readiness";
import { buildStatements, type PointRow } from "./statements";

const pt = (concept: string, periodEnd: string, val: number | null, kind: "flow" | "stock" = "flow"): PointRow => ({ concept, kind, periodEnd, vintage: "latest", val, sourceFiled: periodEnd });
const dense = (periodEnd: string, ni: number | null) => [
  pt("NetIncomeLoss", periodEnd, ni),
  pt("NetCashProvidedByUsedInOperatingActivities", periodEnd, 1),
  pt("RevenueFromContractWithCustomerExcludingAssessedTax", periodEnd, 100),
  pt("GrossProfit", periodEnd, 50),
  pt("OperatingIncomeLoss", periodEnd, 20),
  pt("DepreciationDepletionAndAmortization", periodEnd, 5),
  pt("IncomeTaxExpenseBenefit", periodEnd, 2),
  pt("EarningsPerShareDiluted", periodEnd, 1),
];

describe("research readiness classification", () => {
  it("keeps coverage labels mechanical rather than promotional", () => {
    expect(factorReadiness({ points: 0, companies: 0 })).toBe("not_evaluated");
    expect(factorReadiness({ points: 400, companies: 20 })).toBe("pilot_candidate");
    expect(factorReadiness({ points: 100, companies: 10 })).toBe("limited");
    expect(factorReadiness({ points: 99, companies: 50 })).toBe("insufficient_data");
  });
});

describe("independent derived-statement audit", () => {
  it("accepts explicit zero debt and independently validates TTM ratios", () => {
    const periods = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const points = periods.flatMap((periodEnd, index) => [
      ...dense(periodEnd, (index + 1) * 10),
      pt("Assets", periodEnd, 1000, "stock"),
      pt("StockholdersEquity", periodEnd, 500, "stock"),
      pt("CashAndCashEquivalentsAtCarryingValue", periodEnd, 100, "stock"),
      pt("ShortTermBorrowings", periodEnd, 0, "stock"),
      pt("LongTermDebtNoncurrent", periodEnd, 0, "stock"),
    ]);
    const view = buildStatements({ points, fyEnd: null, mode: "quarterly", vintage: "latest", periods: 4 });
    const audit = auditStatementView(view, points);
    expect(audit.issues).toEqual([]);
    expect(audit.netDebt.nonNull).toBeGreaterThan(0);
    expect(audit.roeTtm.nonNull).toBeGreaterThan(0);
    expect(audit.roaTtm.nonNull).toBeGreaterThan(0);
  });

  it("detects a derived netDebt mismatch instead of accepting zero substitution", () => {
    const periodEnd = "2025-12-31";
    const points = [
      ...dense(periodEnd, 10),
      pt("CashAndCashEquivalentsAtCarryingValue", periodEnd, 100, "stock"),
      pt("ShortTermBorrowings", periodEnd, 50, "stock"),
      pt("LongTermDebtNoncurrent", periodEnd, 100, "stock"),
    ];
    const view = buildStatements({ points, fyEnd: null, mode: "quarterly", vintage: "latest", periods: 4 });
    const netDebtRow = view.sections.flatMap((section) => section.rows).find((row) => row.key === "netDebt")!;
    netDebtRow.cells[0].v = 0;
    expect(auditStatementView(view, points).issues.some((issue) => issue.type === "net_debt_mismatch")).toBe(true);
  });

  it("does not invent ROE/ROA across a calendar gap", () => {
    const periods = ["2025-03-31", "2025-06-30", "2025-09-30", "2026-03-31"];
    const points = periods.flatMap((periodEnd, index) => [
      ...dense(periodEnd, (index + 1) * 10),
      pt("Assets", periodEnd, 1000, "stock"),
      pt("StockholdersEquity", periodEnd, 500, "stock"),
    ]);
    const view = buildStatements({ points, fyEnd: null, mode: "quarterly", vintage: "latest", periods: 4 });
    const audit = auditStatementView(view, points);
    expect(audit.roeTtm.nonNull).toBe(0);
    expect(audit.roaTtm.nonNull).toBe(0);
    expect(audit.issues).toEqual([]);
  });
});
