/**
 * Statements view-model tests (3e): fiscal labels, vintage resolution
 * (latest / first / as-of — no lookahead), annual aggregation with the
 * partial-FY marker, derived rows, YoY math.
 */
import { describe, expect, it } from "vitest";
import { buildStatements, fiscalLabel, type PointRow } from "./statements";

const FY_SEP = "0926"; // Apple-style September fiscal year end

/** helper: one quarterly flow point, both vintages unless stated */
function pt(
  concept: string,
  periodEnd: string,
  val: number,
  opts: Partial<PointRow> = {}
): PointRow[] {
  const base = { concept, kind: "flow" as const, periodEnd, sourceFiled: periodEnd };
  return [
    { ...base, vintage: "first", val, ...opts },
    { ...base, vintage: "latest", val: opts.val ?? val, ...opts },
  ];
}

/** dense filler so the period passes the grid-density threshold (n >= 8) */
function dense(periodEnd: string): PointRow[] {
  const out: PointRow[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(...pt(`Filler${i}`, periodEnd, i));
  }
  return out;
}

describe("fiscalLabel", () => {
  it("labels quarters against a September FY end", () => {
    expect(fiscalLabel("2026-06-27", FY_SEP)).toBe("FQ3 FY26");
    expect(fiscalLabel("2026-09-26", FY_SEP)).toBe("FQ4 FY26");
    expect(fiscalLabel("2025-12-27", FY_SEP)).toBe("FQ1 FY26");
  });
  it("labels quarters against a January FY end (NVIDIA)", () => {
    expect(fiscalLabel("2026-04-30", "0131")).toBe("FQ1 FY27");
    expect(fiscalLabel("2026-01-31", "0131")).toBe("FQ4 FY26");
  });
  it("falls back to calendar quarters without fyEnd", () => {
    expect(fiscalLabel("2026-03-31", null)).toBe("FQ1 FY26");
  });
});

describe("buildStatements — vintage modes", () => {
  // two quarters; Q2 revised upward in the latest vintage
  const points: PointRow[] = [
    ...dense("2025-12-27"),
    ...dense("2026-03-28"),
    ...pt("RevenueFromContractWithCustomerExcludingAssessedTax", "2025-12-27", 100),
    {
      concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
      kind: "flow",
      periodEnd: "2026-03-28",
      vintage: "first",
      val: 120,
      sourceFiled: "2026-04-25",
    },
    {
      concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
      kind: "flow",
      periodEnd: "2026-03-28",
      vintage: "latest",
      val: 135, // restated upward, filed later
      sourceFiled: "2026-07-20",
    },
  ];

  it("latest sees the restatement, first does not", () => {
    const latest = buildStatements({ points, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 4 });
    const first = buildStatements({ points, fyEnd: FY_SEP, mode: "quarterly", vintage: "first", periods: 4 });
    const revRow = (v: ReturnType<typeof buildStatements>) =>
      v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    expect(revRow(latest).cells[0].v).toBe(135);
    expect(revRow(first).cells[0].v).toBe(120);
  });

  it("as-of before the restatement falls back to the first vintage (no lookahead)", () => {
    const v = buildStatements({
      points, fyEnd: FY_SEP, mode: "quarterly", vintage: "asOf", asOf: "2026-05-01", periods: 4,
    });
    const revRow = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    expect(revRow.cells[0].v).toBe(120); // restatement filed 2026-07-20 — invisible on May 1
    expect(v.vintageNote).toContain("as of 2026-05-01");
  });

  it("as-of after the restatement sees it", () => {
    const v = buildStatements({
      points, fyEnd: FY_SEP, mode: "quarterly", vintage: "asOf", asOf: "2026-08-01", periods: 4,
    });
    const revRow = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    expect(revRow.cells[0].v).toBe(135);
  });
});

describe("buildStatements — derivations and YoY", () => {
  // one full fiscal year (Dec-24…Sep-25) + two quarters of FY26, for YoY/annual
  const qs = ["2024-12-28", "2025-03-29", "2025-06-28", "2025-09-27", "2025-12-27", "2026-03-28"];
  const points: PointRow[] = qs.flatMap((pe) => [
    ...dense(pe),
    ...pt("RevenueFromContractWithCustomerExcludingAssessedTax", pe, 100),
    ...pt("NetCashProvidedByUsedInOperatingActivities", pe, 40),
    ...pt("PaymentsToAcquirePropertyPlantAndEquipment", pe, 10),
    ...pt("CostOfGoodsAndServicesSold", pe, 60),
  ]);

  it("derives FCF = CFO − capex with a negative capex display", () => {
    const v = buildStatements({ points, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 5 });
    const cf = v.sections.find((s) => s.key === "cashflow")!;
    const fcf = cf.rows.find((r) => r.key === "fcf")!;
    const capex = cf.rows.find((r) => r.key === "capex")!;
    expect(fcf.derived).toBe(true);
    expect(fcf.cells[0].v).toBe(30);
    expect(capex.cells[0].v).toBe(-10);
  });

  it("FCF is null when capex is missing — no optimistic CFO-only fallback (3h)", () => {
    const noCapex: PointRow[] = qs.flatMap((pe) => [
      ...dense(pe),
      ...pt("NetCashProvidedByUsedInOperatingActivities", pe, 40),
    ]);
    const v = buildStatements({ points: noCapex, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 5 });
    const cf = v.sections.find((s) => s.key === "cashflow")!;
    const fcf = cf.rows.find((r) => r.key === "fcf");
    // the row is dropped entirely (no data across the grid) or all-null
    expect(fcf === undefined || fcf.cells.every((c) => c.v === null)).toBe(true);
  });

  it("derives gross profit from revenue − cost when GrossProfit is absent", () => {
    const v = buildStatements({ points, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 5 });
    const gp = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "gp")!;
    expect(gp.cells[0].v).toBe(40);
    const gm = v.sections.find((s) => s.key === "ratios")!.rows.find((r) => r.key === "grossMargin")!;
    expect(gm.cells[0].v).toBeCloseTo(0.4);
  });

  it("computes YoY against the same fiscal quarter one year back", () => {
    const v = buildStatements({ points, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 5 });
    const rev = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    expect(rev.yoy[0]).toBeCloseTo(0); // 100 vs 100
    expect(rev.yoy[4]).toBeNull(); // oldest visible quarter has no prior year
  });

  it("keeps YoY calendar-aligned when a quarter drops out of the grid (3h regression)", () => {
    // 2025-06-28 carries only revenue (2 rows < the 8-point grid threshold),
    // so the visible grid skips it: [2026-03, 2025-12, 2025-09, 2025-03, 2024-12].
    // An index-offset YoY (i+4) would compare 2026-03 against 2024-12 — two
    // years back. Calendar matching must find 2025-03 instead.
    const holey: PointRow[] = qs.flatMap((pe) => {
      const revVal = pe === "2026-03-28" ? 130 : pe === "2024-12-28" ? 200 : 100;
      return pe === "2025-06-28"
        ? pt("RevenueFromContractWithCustomerExcludingAssessedTax", pe, 50)
        : [...dense(pe), ...pt("RevenueFromContractWithCustomerExcludingAssessedTax", pe, revVal)];
    });
    const v = buildStatements({ points: holey, fyEnd: FY_SEP, mode: "quarterly", vintage: "latest", periods: 5 });
    expect(v.periods.map((p) => p.end)).not.toContain("2025-06-28"); // hole confirmed
    const rev = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    expect(rev.cells[0].v).toBe(130); // 2026-03
    expect(rev.yoy[0]).toBeCloseTo(0.3); // vs 2025-03 (100), NOT vs 2024-12 (200)
    // 2025-09's prior-year quarter (2024-09) is absent entirely → null
    expect(rev.yoy[2]).toBeNull();
  });

  it("annual mode sums flows over the fiscal year and marks partial years", () => {
    const v = buildStatements({ points, fyEnd: FY_SEP, mode: "annual", vintage: "latest", periods: 3 });
    const rev = v.sections.find((s) => s.key === "income")!.rows.find((r) => r.key === "rev")!;
    // FY26 (ends Sep 2026): only Dec-25 + Mar-26 quarters visible → partial
    expect(rev.cells[0]).toEqual({ v: 200, partial: true });
    // FY25 (ends Sep 2025): all four quarters → 400, not partial
    expect(rev.cells[1]).toEqual({ v: 400 });
    expect(v.periods.map((p) => p.label)).toEqual(["FY26", "FY25"]);
  });
});

describe("buildStatements — debt evidence", () => {
  const periodEnd = "2025-12-31";
  const stock = (concept: string, value: number) => pt(concept, periodEnd, value, { kind: "stock" });
  const withGrid = (rows: PointRow[][]) => [...dense(periodEnd), ...rows.flat()];
  const cash = stock("CashAndCashEquivalentsAtCarryingValue", 100);
  const latestDerived = (points: PointRow[], key: string): number | null => {
    const view = buildStatements({ points, fyEnd: null, mode: "quarterly", vintage: "latest", periods: 4 });
    const row = view.sections.flatMap((section) => section.rows).find((candidate) => candidate.key === key);
    return row?.cells[0]?.v ?? null;
  };

  it("returns null rather than negative cash when both debt components are missing", () => {
    expect(latestDerived(withGrid([cash]), "netDebt")).toBeNull();
  });

  it("preserves explicit reported zero debt", () => {
    const points = withGrid([cash, stock("ShortTermBorrowings", 0), stock("LongTermDebtNoncurrent", 0)]);
    expect(latestDerived(points, "netDebt")).toBe(-100);
  });

  it("fails closed when only one debt component is known and no curated total exists", () => {
    expect(latestDerived(withGrid([cash, stock("ShortTermBorrowings", 50)]), "netDebt")).toBeNull();
    expect(latestDerived(withGrid([cash, stock("LongTermDebtNoncurrent", 50)]), "netDebt")).toBeNull();
  });

  it("uses curated total debt once without adding current or noncurrent components", () => {
    const fallback = withGrid([cash, stock("ShortTermBorrowings", 25), stock("LongTermDebt", 100)]);
    expect(latestDerived(fallback, "netDebt")).toBe(0);
    const complete = withGrid([cash, stock("ShortTermBorrowings", 25), stock("LongTermDebtNoncurrent", 75), stock("LongTermDebt", 1000)]);
    expect(latestDerived(complete, "netDebt")).toBe(0);
  });

  it("keeps missing cash unknown instead of treating it as zero", () => {
    expect(latestDerived(withGrid([stock("LongTermDebt", 100)]), "netDebt")).toBeNull();
  });
});

describe("buildStatements — consecutive TTM quarters", () => {
  type QuarterValue = [string, number | null];
  const fourQuarters: QuarterValue[] = [["2025-03-31", 10], ["2025-06-30", 20], ["2025-09-30", 30], ["2025-12-31", 40]];
  const pointsFor = (quarters: QuarterValue[]): PointRow[] => quarters.flatMap(([periodEnd, value]) => [
    ...dense(periodEnd),
    ...pt("NetIncomeLoss", periodEnd, value ?? 0, { val: value }),
    ...pt("StockholdersEquity", periodEnd, 1000, { kind: "stock" }),
    ...pt("Assets", periodEnd, 2000, { kind: "stock" }),
  ]);
  const ratios = (quarters: QuarterValue[], mode: "quarterly" | "annual" = "quarterly") => {
    const view = buildStatements({ points: pointsFor(quarters), fyEnd: null, mode, vintage: "latest", periods: mode === "annual" ? 1 : 6 });
    const value = (key: string) => view.sections.flatMap((section) => section.rows).find((row) => row.key === key)?.cells[0]?.v ?? null;
    return { view, roe: value("roeTtm"), roa: value("roaTtm") };
  };

  it("sums exactly four consecutive quarters", () => {
    const result = ratios(fourQuarters);
    expect(result.roe).toBeCloseTo(0.1);
    expect(result.roa).toBeCloseTo(0.05);
  });

  it("returns null when the visible grid skips a calendar quarter", () => {
    const result = ratios([["2025-03-31", 10], ["2025-06-30", 20], ["2025-09-30", 30], ["2026-03-31", 40]]);
    expect(result.view.periods.map((period) => period.end)).not.toContain("2025-12-31");
    expect(result.roe).toBeNull();
    expect(result.roa).toBeNull();
  });

  it("returns null when any required cell is null even if four grid positions exist", () => {
    const result = ratios([["2025-03-31", 10], ["2025-06-30", 20], ["2025-09-30", null], ["2025-12-31", 40]]);
    expect(result.view.periods).toHaveLength(4);
    expect(result.roe).toBeNull();
    expect(result.roa).toBeNull();
  });

  it("uses only the latest four of more than four consecutive quarters", () => {
    const result = ratios([...fourQuarters, ["2026-03-31", 50]]);
    expect(result.roe).toBeCloseTo(0.14);
    expect(result.roa).toBeCloseTo(0.07);
  });

  it("accepts consecutive quarter indices on a 53-week fiscal calendar without a day-count gate", () => {
    const result = ratios([["2025-01-04", 10], ["2025-04-05", 20], ["2025-07-05", 30], ["2025-10-11", 40]]);
    expect(Date.parse("2025-10-11") - Date.parse("2025-07-05")).toBe(98 * 86_400_000);
    expect(result.roe).toBeCloseTo(0.1);
    expect(result.roa).toBeCloseTo(0.05);
  });

  it("preserves annual ROE and ROA behavior", () => {
    const result = ratios(fourQuarters, "annual");
    expect(result.view.periods.map((period) => period.label)).toEqual(["FY25"]);
    expect(result.roe).toBeCloseTo(0.1);
    expect(result.roa).toBeCloseTo(0.05);
  });
});
