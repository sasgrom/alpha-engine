import { describe, expect, it } from "vitest";
import type { DeskCompanyStatements, DeskStatementCell, DeskStatementSum } from "../../contracts/desk-company";
import { buildDeskScreenCompany, type StandardPriceRow } from "./desk-company";

const ENDS = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
const cell = (value: number | null, over: Partial<DeskStatementCell> = {}): DeskStatementCell | null => (value === null ? null : { value, filed: "2026-10-30", source: "t:Tag", ...over });
const sum = (value: number | null, over: Partial<DeskStatementSum> = {}): DeskStatementSum | null => (value === null ? null : { value, ...over });

/** Eight quarters; `lines` gives the quarterly cells, `years` the trailing-year cells, per line code. */
function statements(over: { quarterly?: Record<string, Array<DeskStatementCell | null>>; years?: Record<string, Array<DeskStatementSum | null>>; cashflow?: Record<string, Array<DeskStatementSum | null>>; unfiledLast?: boolean } = {}): DeskCompanyStatements {
  const row = (code: string, cells: Array<DeskStatementCell | null>) => ({ code, label: code, kind: "flow" as const, cells });
  const sums = (table: Record<string, Array<DeskStatementSum | null>> = {}) => Object.entries(table).map(([code, cells]) => ({ code, cells }));
  return {
    schemaVersion: 2, cik: 5, ticker: "SCRN", name: "Screen Co", standard: "v-test", standardGeneratedAt: "", builtAt: "",
    quarters: ENDS.map((end, index) => ({ end, fy: 2025, fq: 1, form: "10-Q", filed: over.unfiledLast && index === ENDS.length - 1 ? null : `filed-${end}` })),
    statements: { income: Object.entries(over.quarterly ?? {}).map(([code, cells]) => row(code, cells)), balance: [], cashflow: [] },
    years: [], annual: { income: [], balance: [], cashflow: [] },
    trailing: { income: sums(over.years), balance: [], cashflow: sums(over.cashflow) },
  };
}
const eight = <T,>(last: T, yearAgo: T | null = null): Array<T | null> => [null, null, null, yearAgo, null, null, null, last];
const steady = [100, 100, 100, 100, 110, 110, 110, 110].map((value) => cell(value));
const prices = (sessions: number, close = 50, volume = 2_000_000): StandardPriceRow[] => Array.from({ length: sessions }, (_, index) => ({ date: `d${index}`, close: String(close), dividend: "", splitRatio: "", distribution: "", volume: String(volume) }));

describe("the Screener's fundamentals", () => {
  it("reads the four quarters ending at the last reported quarter, in the latest filed figures and on today's share basis", () => {
    const out = buildDeskScreenCompany({
      statements: statements({
        quarterly: { revenue: steady },
        years: {
          revenue: eight(sum(440), sum(400)),
          // restated since: the latest figure counts
          netIncComStock: eight(sum(80, { restated: 88 })),
          netinc: eight(sum(90)),
          // a two-for-one split after the report: half per share today
          epsDil: eight(sum(8.8, { ratio: true, factor: 2 })),
        },
        cashflow: { freeCashFlow: eight(sum(66)) },
      }),
      prices: prices(80),
    })!;
    expect(out).toEqual({ cik: 5, ticker: "SCRN", periodEnd: "2026-09-30", filed: "filed-2026-09-30", revenue: 440, revenueYearAgo: 400, netIncome: 88, freeCashFlow: 66, epsDiluted: 4.4, epsHow: "year", dollarVolume: 100_000_000 });
  });

  it("falls back to the last quarter's diluted shares where the year has no per-share figure, and says so", () => {
    const shares = eight(cell(1_000, { factor: 10 }));
    const out = buildDeskScreenCompany({ statements: statements({ quarterly: { revenue: steady, shareswaDil: shares }, years: { revenue: eight(sum(440)), netinc: eight(sum(50_000)) } }), prices: null })!;
    // net income / (1,000 shares as filed x 10 for the split since)
    expect(out).toMatchObject({ netIncome: 50_000, epsDiluted: 5, epsHow: "last_shares", dollarVolume: null, revenueYearAgo: null });
    // a share count marked out of scale gives no figure
    const marked = buildDeskScreenCompany({ statements: statements({ quarterly: { shareswaDil: eight(cell(1_000, { suspect: true })) }, years: { netinc: eight(sum(50_000)) } }), prices: null })!;
    expect(marked).toMatchObject({ epsDiluted: null, epsHow: null });
  });

  it("withholds a year's revenue when one quarter is above three times each of the others", () => {
    // the fourth quarter holds the whole year's figure
    const slip = [100, 100, 100, 100, 110, 440, 112, 114].map((value) => cell(value));
    const out = buildDeskScreenCompany({ statements: statements({ quarterly: { revenue: slip }, years: { revenue: eight(sum(776), sum(400)), netinc: eight(sum(40)) } }), prices: null })!;
    expect(out).toMatchObject({ revenue: null, revenueYearAgo: 400, netIncome: 40 });
    // fast growth is no slip: the last quarter is not three times the one before it
    const boom = [100, 100, 100, 100, 100, 150, 300, 500].map((value) => cell(value));
    expect(buildDeskScreenCompany({ statements: statements({ quarterly: { revenue: boom }, years: { revenue: eight(sum(1050), sum(400)) } }), prices: null })!.revenue).toBe(1050);
  });

  it("steps back to the last quarter with a report of its own, needs a month of sessions for the volume, and gives nothing without a report", () => {
    const out = buildDeskScreenCompany({ statements: statements({ unfiledLast: true, years: { revenue: [null, null, null, null, null, null, sum(430), sum(440)] } }), prices: prices(20) })!;
    expect(out).toMatchObject({ periodEnd: "2026-06-30", revenue: 430, dollarVolume: null });
    const none = statements();
    none.quarters = none.quarters.map((quarter) => ({ ...quarter, filed: null }));
    expect(buildDeskScreenCompany({ statements: none, prices: null })).toBeNull();
  });
});
