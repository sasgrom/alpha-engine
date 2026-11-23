import { describe, expect, it } from "vitest";
import { buildDeskCompanyStatements, sourceLabel, type StandardCompanyDoc, type StandardField } from "./desk-company";

const fields: StandardField[] = [
  { code: "revenue", statement: "income", kind: "flow", meaning: "Revenue" },
  { code: "opex", statement: "income", kind: "flow", meaning: "Operating expenses" },
  { code: "totalAssets", statement: "balance", kind: "instant", meaning: "Total assets" },
  { code: "ncfo", statement: "cashflow", kind: "flow", meaning: "Net cash flow from operations" },
  { code: "rnd", statement: "income", kind: "flow", meaning: "Research and development" },
];

const doc: StandardCompanyDoc = {
  schemaVersion: 2,
  cik: 1,
  ticker: "TEST",
  name: "Test Company",
  quarters: [
    { end: "2025-03-31", fy: 2025, fq: 1, filed: "2026-05-01", form: "comparative" },
    { end: "2025-12-31", fy: 2025, fq: 4, filed: "2026-02-10", form: "10-K" },
    { end: "2026-03-31", fy: 2026, fq: 1, filed: "2026-05-01", form: "10-Q" },
    { end: "2026-06-30", fy: 2026, fq: 2, filed: "2026-08-01", form: "10-Q" },
  ],
  sources: ["t:Revenues", "d0:opex", "y:NetCashProvidedByUsedInOperatingActivities", "t:Assets"],
  fields: {
    revenue: [[0, [["2026-05-01", 90, 0]]], [1, [["2026-02-10", 100, 0], ["2026-08-01", 104, 0]]], [2, [["2026-05-01", 110, 0]]], [3, [["2026-08-01", 120, 0]]]],
    opex: [[2, [["2026-05-01", 40, 1]]]],
    totalAssets: [[3, [["2026-08-01", 900, 3]]]],
    ncfo: [[3, [["2026-08-01", 30, 2]]]],
  },
};

const build = (quarters?: number) => buildDeskCompanyStatements({ doc, fields, standard: "v3.1", standardGeneratedAt: "2026-11-13T11:58:15.693Z", builtAt: "2026-11-22T00:00:00Z", quarters });

describe("desk company statements", () => {
  it("keeps the company's own quarters, oldest first, and leaves comparison-only quarters out", () => {
    const out = build();
    expect(out.quarters.map((q) => q.end)).toEqual(["2025-12-31", "2026-03-31", "2026-06-30"]);
    expect(out.quarters[0]).toEqual({ end: "2025-12-31", fy: 2025, fq: 4, form: "10-K", filed: "2026-02-10" });
  });

  it("shows each figure as first reported, with its filing date and tag, and carries a later different figure beside it", () => {
    const revenue = build().statements.income.find((row) => row.code === "revenue")!;
    expect(revenue.label).toBe("Revenue");
    expect(revenue.cells[0]).toEqual({ value: 100, filed: "2026-02-10", source: "Revenues", restated: { value: 104, filed: "2026-08-01" } });
    expect(revenue.cells[1]).toEqual({ value: 110, filed: "2026-05-01", source: "Revenues" });
  });

  it("marks derived values, leaves missing quarters empty and drops lines the company never reported", () => {
    const out = build();
    expect(out.statements.income.find((row) => row.code === "opex")!.cells).toEqual([null, { value: 40, filed: "2026-05-01", source: "derived" }, null]);
    expect(out.statements.income.map((row) => row.code)).toEqual(["revenue", "opex"]);
    expect(out.statements.balance[0].cells[2]).toMatchObject({ value: 900, source: "Assets" });
    expect(out.statements.cashflow[0].cells[2]).toMatchObject({ source: "NetCashProvidedByUsedInOperatingActivities" });
  });

  it("keeps only the newest quarters asked for", () => {
    const out = build(2);
    expect(out.quarters.map((q) => q.end)).toEqual(["2026-03-31", "2026-06-30"]);
    expect(out.statements.income.find((row) => row.code === "revenue")!.cells.map((c) => c?.value)).toEqual([110, 120]);
  });

  it("names sources and refuses another schema", () => {
    expect(sourceLabel("t:Revenues")).toBe("Revenues");
    expect(sourceLabel("y:GrossProfit")).toBe("GrossProfit");
    expect(sourceLabel("x:Revenues")).toBe("Revenues");
    expect(sourceLabel("d0:opex")).toBe("derived");
    expect(sourceLabel(undefined)).toBe("derived");
    expect(() => buildDeskCompanyStatements({ doc: { ...doc, schemaVersion: 1 }, fields, standard: "v1", standardGeneratedAt: "", builtAt: "" })).toThrow("schema 1");
  });
});
