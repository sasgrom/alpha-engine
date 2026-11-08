import { describe, expect, it } from "vitest";
import { extractGoldStatementsFromSource } from "./gold-source-remediation";
import { evidenceInSource } from "./expectations";
import benchmark from "../../research/expectations-benchmark-v1.json";

const nvda = benchmark.documents.find((doc) => doc.ticker === "NVDA")!;
const walmart = benchmark.documents.find((doc) => doc.ticker === "WMT")!;
const source = [
  "Revenue is expected to be $108.0 billion, plus or minus 2% in third quarter of fiscal 2027.",
  "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points in third quarter of fiscal 2027.",
  "GAAP and non-GAAP tax rates of 16% to 18% in full year fiscal 2027.",
].join("\n");

describe("gold statement source extraction", () => {
  it("extracts every NVDA required statement from exact source evidence", () => {
    const { statements, missing } = extractGoldStatementsFromSource(nvda.required, source);
    expect(missing).toEqual([]);
    expect(statements).toHaveLength(5);
    expect(statements.map((statement) => statement.metric)).toEqual(["revenue", "margin", "margin", "tax_rate", "tax_rate"]);
    expect(statements[0]).toMatchObject({ valuePoint: 108, tolerance: 2, toleranceUnit: "percent", unit: "usd_billions" });
    expect(statements[1]).toMatchObject({ basis: "gaap", valuePoint: 74, tolerance: 50, toleranceUnit: "basis_points" });
    expect(statements[2]).toMatchObject({ basis: "non_gaap", valuePoint: 74, tolerance: 50, toleranceUnit: "basis_points" });
    expect(statements[3]).toMatchObject({ basis: "gaap", valueLow: 16, valueHigh: 18, unit: "percent" });
    expect(statements[4]).toMatchObject({ basis: "non_gaap", valueLow: 16, valueHigh: 18, unit: "percent" });
    for (const statement of statements) expect(evidenceInSource(statement.evidence, source)).toBe(true);
  });

  it("does not invent values or metadata when source evidence is absent", () => {
    const { statements, missing } = extractGoldStatementsFromSource(nvda.required, "Unrelated filing text");
    expect(statements).toHaveLength(0);
    expect(missing).toHaveLength(5);
  });

  it("extracts Walmart Q3 net sales with its actual range", () => {
    const required = walmart.required.filter((statement) => statement.metric === "revenue" && statement.periodAny.includes("third quarter"));
    const q3Source = "Net sales are expected to increase 3% to 3.75% in third quarter 2026.";
    const { statements, missing } = extractGoldStatementsFromSource(required, q3Source);
    expect(missing).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ metric: "revenue", qualifier: "range", valueLow: 3, valueHigh: 3.75, unit: "percent" });
    expect(evidenceInSource(statements[0].evidence, q3Source)).toBe(true);
  });
});
