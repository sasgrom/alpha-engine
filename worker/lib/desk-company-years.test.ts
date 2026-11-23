import { describe, expect, it } from "vitest";
import { buildDeskCompanyStatements, scaleSuspects, shareBasis, sumFourQuarters, type ScaleQuarter, type StandardCompanyDoc, type StandardField, type StandardVersion } from "./desk-company";

const fields: StandardField[] = [
  { code: "revenue", statement: "income", kind: "flow", meaning: "Revenue" },
  { code: "netIncComStock", statement: "income", kind: "flow", meaning: "Net income to common stockholders" },
  { code: "epsDil", statement: "income", kind: "perShare", meaning: "Earnings per diluted share" },
  { code: "shareswaDil", statement: "income", kind: "shares", meaning: "Weighted average diluted shares" },
  { code: "totalAssets", statement: "balance", kind: "instant", meaning: "Total assets" },
];

const quarter = (end: string, start: string, fy: number, fq: number, filed: string, form = "10-Q") => ({ end, start, fy, fq, filed, form });
const QUARTERS = [
  quarter("2024-03-31", "2024-01-01", 2024, 1, "2024-05-01"),
  quarter("2024-06-30", "2024-04-01", 2024, 2, "2024-08-01"),
  quarter("2024-09-30", "2024-07-01", 2024, 3, "2024-11-01"),
  quarter("2024-12-31", "2024-10-01", 2024, 4, "2025-02-10", "10-K"),
  quarter("2025-03-31", "2025-01-01", 2025, 1, "2025-05-01"),
  quarter("2025-06-30", "2025-04-01", 2025, 2, "2025-08-01"),
  quarter("2025-09-30", "2025-07-01", 2025, 3, "2025-11-01"),
  quarter("2025-12-31", "2025-10-01", 2025, 4, "2026-02-10", "10-K"),
];
const each = (values: number[], source: number): Array<[number, StandardVersion[]]> => values.map((value, index) => [index, [[QUARTERS[index].filed, value, source]]]);

function company(over: Partial<StandardCompanyDoc["fields"]> = {}): StandardCompanyDoc {
  return {
    schemaVersion: 2, cik: 9, ticker: "YEAR", name: "Year Corp", quarters: QUARTERS,
    sources: ["t:Revenues", "t:NetIncomeLossAvailableToCommonStockholdersBasic", "t:EarningsPerShareDiluted", "t:WeightedAverageNumberOfDilutedSharesOutstanding", "t:Assets", "d0:epsDil"],
    fields: {
      revenue: each([100, 110, 120, 130, 140, 150, 160, 170], 0),
      netIncComStock: each([10e6, 11e6, 12e6, 13e6, 14e6, 15e6, 16e6, 17e6], 1),
      epsDil: each([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7], 2),
      shareswaDil: each([10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 10e6], 3),
      totalAssets: each([900, 910, 920, 930, 940, 950, 960, 970], 4),
      ...over,
    } as StandardCompanyDoc["fields"],
  };
}
const build = (doc: StandardCompanyDoc, splits: Array<{ date: string; ratio: number }> | null = []) =>
  buildDeskCompanyStatements({ doc, fields, standard: "v-test", standardGeneratedAt: "", builtAt: "", splits });
const row = (rows: Array<{ code: string; cells: unknown[] }>, code: string) => rows.find((item) => item.code === code)!;

describe("share basis of the company's own reports", () => {
  const own = QUARTERS.map((q) => ({ filed: q.filed }));
  const flat = QUARTERS.map(() => 10e6);

  it("a report filed on or after the split shows it", () => {
    expect(shareBasis(own, flat, [{ date: "2025-06-10", ratio: 4 }])).toEqual([1, 1, 1, 1, 1, 4, 4, 4]);
  });

  it("a report filed shortly before the split is settled by its share count", () => {
    const split = [{ date: "2025-08-20", ratio: 4 }];
    // the report of 2025-08-01 already counts four times the shares: it stands on the new basis
    expect(shareBasis(own, [10e6, 10e6, 10e6, 10e6, 10e6, 40e6, 40e6, 40e6], split)[5]).toBe(4);
    // it counts the same shares as the quarter before: the old basis
    expect(shareBasis(own, flat, split)[5]).toBe(1);
    // no count, or a jump that is neither: not known
    expect(shareBasis(own, [10e6, 10e6, 10e6, 10e6, 10e6, null, 40e6, 40e6], split)[5]).toBeNull();
    expect(shareBasis(own, [10e6, 10e6, 10e6, 10e6, 10e6, 22e6, 40e6, 40e6], split)[5]).toBeNull();
  });
});

describe("one line over four quarters", () => {
  const days = [91, 91, 92, 92];
  const one = (basisAt: (date: string) => number | null = () => 1) => ({ days, asOf: "2025-02-10", basisAt });

  it("sums flows as known at the last quarter's report and carries the latest figures beside them", () => {
    const versions: StandardVersion[][] = [[["2024-05-01", 100], ["2024-11-01", 101], ["2025-08-01", 105]], [["2024-08-01", 110]], [["2024-11-01", 120]], [["2025-02-10", 130]]];
    expect(sumFourQuarters({ kind: "flow", versions, ...one() })).toEqual({ value: 461, restated: 465 });
  });

  it("takes all four as known on the day the last of them was first filed, never mixing two bases", () => {
    // the annual report restated the year without a business; the fourth quarter on that basis came a year later
    const versions: StandardVersion[][] = [[["2024-05-01", 100], ["2025-05-01", 80]], [["2024-08-01", 110], ["2025-08-01", 88]], [["2024-11-01", 120], ["2025-11-01", 96]], [["2026-02-10", 104]]];
    expect(sumFourQuarters({ kind: "flow", versions, ...one() })).toEqual({ value: 368, filed: "2026-02-10" });
  });

  it("averages share counts by days and sums per-share figures on the basis of the last report", () => {
    const basisAt = (date: string) => (date >= "2024-10-15" ? 2 : 1);
    const shares: StandardVersion[][] = [[["2024-05-01", 10e6]], [["2024-08-01", 10e6]], [["2024-11-01", 20e6]], [["2025-02-10", 22e6]]];
    expect(sumFourQuarters({ kind: "shares", versions: shares, ...one(basisAt) })).toEqual({ value: Math.round((20e6 * 91 + 20e6 * 91 + 20e6 * 92 + 22e6 * 92) / 366) });
    const eps: StandardVersion[][] = [[["2024-05-01", 2]], [["2024-08-01", 2]], [["2024-11-01", 1]], [["2025-02-10", 1]]];
    expect(sumFourQuarters({ kind: "perShare", versions: eps, ...one(basisAt) })).toEqual({ value: 4 });
    // a basis that cannot be told, or share counts that cannot belong to one year, give nothing
    expect(sumFourQuarters({ kind: "perShare", versions: eps, ...one(() => null) })).toBeNull();
    expect(sumFourQuarters({ kind: "shares", versions: [[["2024-05-01", 10e6]], [["2024-08-01", 10e6]], [["2024-11-01", 10e6]], [["2025-02-10", 10_000]]], ...one() })).toBeNull();
    expect(sumFourQuarters({ kind: "flow", versions: [[["2024-05-01", 1]], undefined, [["2024-11-01", 1]], [["2025-02-10", 1]]], ...one() })).toBeNull();
  });
});

describe("share counts and per-share figures out of scale", () => {
  const good: ScaleQuarter = { sharesBasic: 100e6, shareswa: 100e6, shareswaDil: 101e6, eps: 1, epsFiled: true, epsDil: 0.99, epsDilFiled: true, income: 100e6, basis: 1 };

  it("marks a share count given in thousands when the balance sheet and the filed earnings per share agree on the count", () => {
    const [flags] = scaleSuspects([{ ...good, shareswa: 100_000, shareswaDil: 101_000 }]);
    expect([...flags].sort()).toEqual(["shareswa", "shareswaDil"]);
  });

  it("marks a per-share figure in the wrong unit, and leaves small figures alone", () => {
    expect([...scaleSuspects([{ ...good, eps: 0.01, epsDil: 0.0099 }])[0]].sort()).toEqual(["eps", "epsDil"]);
    expect(scaleSuspects([{ ...good, income: 2e6, eps: 0.02, epsDil: 0.0001 }])[0].size).toBe(0);
  });

  it("uses the neighbouring quarters when a quarter has no two estimates that agree", () => {
    // the fourth quarter's count came out of a year given in millions, and its earnings per share were derived from it
    const broken: ScaleQuarter = { ...good, sharesBasic: null, shareswa: 40, shareswaDil: 41, eps: 2_500_000, epsFiled: false, epsDil: 2_400_000, epsDilFiled: false };
    const flags = scaleSuspects([good, good, good, broken, good]);
    expect([...flags[3]].sort()).toEqual(["eps", "epsDil", "shareswa", "shareswaDil"]);
    expect(flags[2].size + flags[4].size).toBe(0);
    // alone, with nothing to compare, nothing is claimed
    expect(scaleSuspects([broken])[0].size).toBe(0);
  });

  it("follows a split through the neighbours' share basis", () => {
    const after: ScaleQuarter = { ...good, sharesBasic: null, shareswa: 400e6, shareswaDil: 404e6, eps: null, epsFiled: false, epsDil: null, epsDilFiled: false, basis: 4 };
    expect(scaleSuspects([good, good, after])[2].size).toBe(0);
  });
});

describe("fiscal years and trailing years of the company statements", () => {
  it("lists the fiscal years and sums each line over the year's four quarters", () => {
    const out = build(company());
    expect(out.years).toEqual([
      { end: "2024-12-31", fy: 2024, filed: "2025-02-10", quarter: 3 },
      { end: "2025-12-31", fy: 2025, filed: "2026-02-10", quarter: 7 },
    ]);
    expect(row(out.annual.income, "revenue").cells).toEqual([{ value: 460 }, { value: 620 }]);
    expect(row(out.annual.income, "shareswaDil").cells).toEqual([{ value: 10e6 }, { value: 10e6 }]);
    // lines that are amounts at a date have no sum: the page reads the year-end cell
    expect(out.annual.balance).toEqual([]);
    expect(out.trailing.balance).toEqual([]);
  });

  it("gives the year ending at each quarter, and nothing before four quarters are there", () => {
    const revenue = row(build(company()).trailing.income, "revenue").cells as Array<{ value: number } | null>;
    expect(revenue.map((cell) => cell?.value ?? null)).toEqual([null, null, null, 460, 500, 540, 580, 620]);
  });

  it("forms a year's earnings per share from net income and the average share count", () => {
    const out = build(company());
    expect(row(out.annual.income, "epsDil").cells).toEqual([{ value: 4.6, ratio: true }, { value: 6.2, ratio: true }]);
    // without the share count the quarters' own figures are summed
    const noShares = build(company({ shareswaDil: [] }));
    expect(row(noShares.annual.income, "epsDil").cells).toEqual([{ value: 4.6 }, { value: 6.2 }]);
  });

  it("puts a year with a split inside it on the share basis of the annual report", () => {
    // a 2-for-1 split on 2025-06-10: the reports from August count twice the shares and half the earnings per share
    const doc = company({
      shareswaDil: each([10e6, 10e6, 10e6, 10e6, 10e6, 20e6, 20e6, 20e6], 3),
      epsDil: each([1, 1.1, 1.2, 1.3, 1.4, 0.75, 0.8, 0.85], 2),
    });
    const out = build(doc, [{ date: "2025-06-10", ratio: 2 }]);
    expect(row(out.annual.income, "shareswaDil").cells[1]).toEqual({ value: 20e6 });
    expect(row(out.annual.income, "epsDil").cells[1]).toEqual({ value: 3.1, ratio: true });
    // figures from before the split say how far their basis is from today's, so the page can show one basis
    expect(row(out.annual.income, "shareswaDil").cells[0]).toEqual({ value: 10e6, factor: 2 });
    expect(row(out.annual.income, "epsDil").cells[0]).toEqual({ value: 4.6, ratio: true, factor: 2 });
    const quarterly = row(out.statements.income, "epsDil").cells as Array<{ value: number; factor?: number }>;
    expect(quarterly.map((cell) => cell.factor ?? 1)).toEqual([2, 2, 2, 2, 2, 1, 1, 1]);
    expect(row(out.annual.income, "revenue").cells[0]).toEqual({ value: 460 });
  });

  it("does not call a figure restated when a later filing only put it on the new share basis", () => {
    const doc = company({
      shareswaDil: each([10e6, 10e6, 10e6, 10e6, 10e6, 20e6, 20e6, 20e6], 3),
      epsDil: [
        ...each([1, 1.1, 1.2, 1.3], 2),
        [4, [["2025-05-01", 1.4, 2], ["2026-02-10", 0.7, 2]]],   // the same earnings, halved by the split
        [5, [["2025-08-01", 0.75, 2], ["2026-02-10", 0.9, 2]]],  // a real change
        ...each([0, 0, 0, 0, 0, 0, 0.8, 0.85], 2).slice(6),
      ],
    });
    const cells = row(build(doc, [{ date: "2025-06-10", ratio: 2 }]).statements.income, "epsDil").cells as Array<{ value: number; restated?: unknown; factor?: number }>;
    expect(cells[4]).toMatchObject({ value: 1.4, factor: 2 });
    expect(cells[4].restated).toBeUndefined();
    expect(cells[5].restated).toEqual({ value: 0.9, filed: "2026-02-10" });
    // the splits are not known (no standard price file): no share-count or per-share years, flows stay
    const unknown = build(doc, null);
    expect(row(unknown.annual.income, "shareswaDil").cells).toEqual([null, null]);
    expect(row(unknown.annual.income, "epsDil").cells).toEqual([null, null]);
    expect(row(unknown.annual.income, "revenue").cells[1]).toEqual({ value: 620 });
  });

  it("marks an out-of-scale quarter and keeps it out of the year", () => {
    const doc = company({ shareswaDil: each([10e6, 10e6, 10e6, 10e6, 10e6, 10_000, 10e6, 10e6], 3) });
    const out = build(doc);
    const quarterly = row(out.statements.income, "shareswaDil").cells as Array<{ suspect?: true } | null>;
    expect(quarterly.map((cell) => cell?.suspect ?? false)).toEqual([false, false, false, false, false, true, false, false]);
    expect(row(out.annual.income, "shareswaDil").cells).toEqual([{ value: 10e6 }, null]);
    // the year's earnings per share fall back to the quarters' own filed figures
    expect(row(out.annual.income, "epsDil").cells[1]).toEqual({ value: 6.2 });
  });

  it("gives no year across a gap in the quarters", () => {
    const doc = company();
    doc.quarters = QUARTERS.map((q, index) => (index === 5 ? { ...q, start: "2025-05-15" } : q));
    const revenue = row(build(doc).annual.income, "revenue").cells;
    expect(revenue).toEqual([{ value: 460 }, null]);
  });
});
