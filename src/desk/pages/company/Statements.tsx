import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DeskCompanyStatements, DeskStatementCell, DeskStatementKind, DeskStatementName, DeskStatementQuarter, DeskStatementSum } from "@contracts/desk-company";
import { PeriodBars } from "../../charts/PeriodBars";
import { Card, Segmented, Shimmer } from "../../components";
import { useDesk } from "../../context";
import { fmtCompact, fmtDate, fmtNum } from "../../format";

export type StatementPeriod = "quarterly" | "annual" | "trailing";
type Span = "8" | "20" | "40";

const STATEMENTS: { value: DeskStatementName; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "balance", label: "Balance sheet" },
  { value: "cashflow", label: "Cash flow" },
];
const PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "trailing", label: "Trailing year" },
];
const SPANS: { value: Span; label: string }[] = [
  { value: "8", label: "2 years" },
  { value: "20", label: "5 years" },
  { value: "40", label: "10 years" },
];
const SUBTITLE: Record<StatementPeriod, string> = {
  quarterly: "Quarterly figures as first reported to the SEC",
  annual: "Fiscal years, from the four quarters as known at each annual report",
  trailing: "The year ending at each quarter, from the four quarters as known at that quarter's report",
};
const CHART_TITLE: Record<StatementPeriod, string> = { quarterly: "by quarter", annual: "by fiscal year", trailing: "year ending at each quarter" };
/** The line charted until the reader picks one. */
const HEADLINE: Record<DeskStatementName, string> = { income: "revenue", balance: "totalAssets", cashflow: "ncfo" };

export function formatStatementValue(value: number, kind: DeskStatementKind): string {
  return kind === "perShare" ? fmtNum(value, 2) : fmtCompact(value);
}

export function quarterLabel(quarter: DeskStatementQuarter): string {
  if (quarter.fq == null || quarter.fy == null) return fmtDate(quarter.end, "medium");
  return `Q${quarter.fq} ${String(quarter.fy).slice(-2).padStart(2, "0")}`;
}

/** A share count or per-share figure on today's share basis (a later split applied); other figures as they are. */
export function onTodaysBasis(value: number, kind: DeskStatementKind, factor: number | undefined): number {
  return factor === undefined ? value : kind === "perShare" ? value / factor : value * factor;
}
const filedAs = (value: number, kind: DeskStatementKind, factor: number | undefined) =>
  (factor === undefined ? "" : `On today's share basis; as filed ${formatStatementValue(value, kind)}, before a later share split · `);

/** What the reader sees on hover: where the figure came from and whether a later filing changed it. */
export function cellProvenance(cell: DeskStatementCell, kind: DeskStatementKind): string {
  const from = cell.source === "derived" ? "computed from other reported lines" : `XBRL tag ${cell.source}`;
  const first = `First reported in the filing of ${fmtDate(cell.filed, "medium")} · ${from}`;
  return cell.restated
    ? `${first} · later filed as ${formatStatementValue(cell.restated.value, kind)} on ${fmtDate(cell.restated.filed, "medium")}`
    : first;
}

/** How a fiscal-year or trailing-year figure was formed, and from which filings. */
export function sumProvenance(sum: DeskStatementSum, kind: DeskStatementKind, reported: string | null): string {
  const how = kind === "shares"
    ? "Average of the four quarters' share counts, weighted by days"
    : kind === "perShare"
      ? sum.ratio ? "Net income to common stockholders of the four quarters ÷ their average share count" : "Sum of the four quarters' figures"
      : "Sum of the four quarters";
  const known = sum.filed
    ? ` · figures as known on ${fmtDate(sum.filed, "medium")}, when all four were on file (the year was restated)`
    : reported ? ` · figures as known at the report of ${fmtDate(reported, "medium")}` : "";
  return `${how}${known}${sum.restated !== undefined ? ` · from the latest filings: ${formatStatementValue(sum.restated, kind)}` : ""}`;
}

export interface ViewColumn { key: string; label: string; title: string }
/** `value` is null for a filed figure that is out of scale: it is named, not shown. */
export interface ViewCell { value: number | null; title: string; mark?: "restated" | "suspect" }
export interface ViewRow { code: string; label: string; kind: DeskStatementKind; cells: Array<ViewCell | null> }
export interface StatementView { columns: ViewColumn[]; rows: ViewRow[]; emptyTitle: string; yearSteps: number }

function quarterCell(cell: DeskStatementCell | null, kind: DeskStatementKind): ViewCell | null {
  if (!cell) return null;
  if (cell.suspect) {
    return { value: null, mark: "suspect", title: `The filed figure, ${formatStatementValue(cell.value, kind)}, is out of scale against the company's other share figures: a units slip in the filing of ${fmtDate(cell.filed, "medium")}, or a figure derived from one. It is left out.` };
  }
  return { value: onTodaysBasis(cell.value, kind, cell.factor), title: `${filedAs(cell.value, kind, cell.factor)}${cellProvenance(cell, kind)}`, mark: cell.restated ? "restated" : undefined };
}

/** One statement as a table of periods: the quarters, the fiscal years, or the year ending at each quarter. */
export function statementView(data: DeskCompanyStatements, statement: DeskStatementName, period: StatementPeriod): StatementView {
  const quarterly = data.statements[statement];
  const quarterColumn = (quarter: DeskStatementQuarter, lead: string): ViewColumn => ({
    key: quarter.end, label: quarterLabel(quarter),
    title: `${lead} ${fmtDate(quarter.end, "medium")}${quarter.form ? ` · ${quarter.form}${quarter.filed ? ` filed ${fmtDate(quarter.filed, "medium")}` : ""}` : ""}`,
  });
  if (period === "quarterly") {
    return {
      columns: data.quarters.map((quarter) => quarterColumn(quarter, "Quarter ended")), emptyTitle: "Not reported", yearSteps: 4,
      rows: quarterly.map((row) => ({ code: row.code, label: row.label, kind: row.kind, cells: row.cells.map((cell) => quarterCell(cell, row.kind)) })),
    };
  }
  const annual = period === "annual";
  const sums = new Map((annual ? data.annual : data.trailing)[statement].map((row) => [row.code, row.cells]));
  // the quarter column behind each period: a fiscal year's last quarter, or the quarter a trailing year ends at
  const at = annual ? data.years.map((year) => year.quarter) : data.quarters.map((_, column) => column);
  const columns = annual
    ? data.years.map((year) => ({ key: year.end, label: `FY ${year.fy ?? year.end.slice(0, 4)}`, title: `Fiscal year ended ${fmtDate(year.end, "medium")}${year.filed ? ` · annual report filed ${fmtDate(year.filed, "medium")}` : ""}` }))
    : data.quarters.map((quarter) => quarterColumn(quarter, "Year ended"));
  return {
    columns, yearSteps: annual ? 1 : 4,
    emptyTitle: "No figure: one of the four quarters is missing or out of scale, or the four do not make one year",
    rows: quarterly.map((row) => ({
      code: row.code, label: row.label, kind: row.kind,
      cells: at.map((column, index) => {
        // an amount at a date (the balance sheet) is the period's last quarter-end figure
        if (row.kind === "instant") return quarterCell(row.cells[column], row.kind);
        const sum = sums.get(row.code)?.[index] ?? null;
        if (!sum) return null;
        return {
          value: onTodaysBasis(sum.value, row.kind, sum.factor), mark: sum.restated !== undefined ? "restated" as const : undefined,
          title: `${filedAs(sum.value, row.kind, sum.factor)}${sumProvenance(sum, row.kind, data.quarters[column]?.filed ?? null)}`,
        };
      }),
    })),
  };
}

export function StatementsTable({ view, span, line, onLine }: { view: StatementView; span: number; line: string | null; onLine: (code: string) => void }) {
  const from = Math.max(0, view.columns.length - span);
  const columns = view.columns.slice(from);
  const wrap = useRef<HTMLDivElement | null>(null);
  const newest = columns.at(-1)?.key ?? "";
  // a table wider than the card opens at its newest periods
  useEffect(() => {
    if (wrap.current) wrap.current.scrollLeft = wrap.current.scrollWidth;
  }, [newest, columns.length]);
  if (!columns.length || !view.rows.length) return <div className="desk-empty">The company reported no lines for this statement in the standard data.</div>;
  return (
    <div ref={wrap} className="desk-table-wrap scroll" style={{ maxHeight: "none" }}>
      <table className="desk-table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr>
            <th scope="col" style={{ left: 0, zIndex: 3 }}>Line</th>
            {columns.map((column) => <th key={column.key} scope="col" className="num" title={column.title}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.code}>
              {/* the line names stay in view while a wide table is scrolled to its older periods */}
              <th scope="row" style={{ fontWeight: 500, textAlign: "left", whiteSpace: "normal", minWidth: 220, position: "sticky", left: 0, top: "auto", zIndex: 1, boxShadow: "1px 0 0 var(--d-border)" }}>
                <button type="button" className="desk-line-button" aria-pressed={row.code === line} onClick={() => onLine(row.code)} title="Chart this line">{row.label}</button>
              </th>
              {row.cells.slice(from).map((cell, index) => (
                <td key={columns[index].key} className="num" title={cell ? cell.title : view.emptyTitle}>
                  {cell === null ? (
                    <span className="desk-muted">–</span>
                  ) : cell.value === null ? (
                    <span className="desk-muted">n/a</span>
                  ) : (
                    <>
                      {formatStatementValue(cell.value, row.kind)}
                      {cell.mark === "restated" && <sup className="desk-muted" aria-label="later restated"> r</sup>}
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompanyStatements({ cik }: { cik: number }) {
  const { palette } = useDesk();
  const [statement, setStatement] = useState<DeskStatementName>("income");
  const [period, setPeriod] = useState<StatementPeriod>("quarterly");
  const [span, setSpan] = useState<Span>("8");
  const [line, setLine] = useState<string | null>(null);
  const query = trpc.desk.companyStatements.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const data = query.data;
  const view = data ? statementView(data, statement, period) : null;
  // the charted line: the one chosen, else the statement's headline (revenue, total assets, cash from operations)
  const charted = view ? view.rows.find((row) => row.code === line) ?? view.rows.find((row) => row.code === HEADLINE[statement]) ?? view.rows[0] ?? null : null;
  return (
    <Card
      className="desk-span-12"
      title="Financial statements"
      subtitle={data
        ? `${SUBTITLE[period]} · standard fundamentals ${data.standard} · US dollars; per-share lines in dollars`
        : SUBTITLE.quarterly}
      action={data ? (
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Segmented options={STATEMENTS} value={statement} onChange={setStatement} label="Statement" />
          <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Period" />
          {period !== "annual" && <Segmented options={SPANS} value={span} onChange={setSpan} label="Quarters shown" />}
        </span>
      ) : undefined}
    >
      {query.isLoading ? (
        <Shimmer height={220} />
      ) : query.error ? (
        <div className="desk-empty">The statements could not be loaded: {query.error.message}</div>
      ) : !data || !view ? (
        <div className="desk-empty">No standard statements are built for this company.</div>
      ) : (
        <>
          {charted && view.columns.length > 0 && (
            <div style={{ marginBottom: 14 }} data-chart-line={charted.code}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{charted.label} <span className="desk-muted" style={{ fontWeight: 400 }}>· {CHART_TITLE[period]}</span></span>
                <span className="desk-muted" style={{ fontSize: 12 }}>Click a line in the table to chart it</span>
              </div>
              <PeriodBars
                bars={view.columns.map((column, index) => ({ key: column.key, label: column.label, title: column.title, value: charted.cells[index]?.value ?? null }))}
                format={(value) => formatStatementValue(value, charted.kind)}
                yearSteps={view.yearSteps}
                name={`${charted.label}, ${CHART_TITLE[period]}`}
                palette={palette}
              />
            </div>
          )}
          <StatementsTable view={view} span={period === "annual" ? view.columns.length : Number(span)} line={charted?.code ?? null} onLine={setLine} />
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            Hover a figure for its filing date and source. <sup>r</sup> marks a figure that a later filing changed; the first report is shown.
            {" "}Share counts and per-share figures are on today's share basis where a split came later; the hover gives the figure as filed.
            {" "}n/a marks a filed share count or per-share figure that is out of scale (a units slip in the filing); it is left out of the yearly figures.
          </p>
        </>
      )}
    </Card>
  );
}
