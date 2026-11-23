import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DeskCompanyStatements, DeskStatementCell, DeskStatementKind, DeskStatementName, DeskStatementQuarter } from "@contracts/desk-company";
import { Card, Segmented, Shimmer } from "../../components";
import { fmtCompact, fmtDate, fmtNum } from "../../format";

const STATEMENTS: { value: DeskStatementName; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "balance", label: "Balance sheet" },
  { value: "cashflow", label: "Cash flow" },
];
const SPANS: { value: "8" | "20"; label: string }[] = [
  { value: "8", label: "2 years" },
  { value: "20", label: "5 years" },
];

export function formatStatementValue(value: number, kind: DeskStatementKind): string {
  return kind === "perShare" ? fmtNum(value, 2) : fmtCompact(value);
}

export function quarterLabel(quarter: DeskStatementQuarter): string {
  if (quarter.fq == null || quarter.fy == null) return fmtDate(quarter.end, "medium");
  return `Q${quarter.fq} ${String(quarter.fy).slice(-2).padStart(2, "0")}`;
}

/** What the reader sees on hover: where the figure came from and whether a later filing changed it. */
export function cellProvenance(cell: DeskStatementCell, kind: DeskStatementKind): string {
  const from = cell.source === "derived" ? "computed from other reported lines" : `XBRL tag ${cell.source}`;
  const first = `First reported in the filing of ${fmtDate(cell.filed, "medium")} · ${from}`;
  return cell.restated
    ? `${first} · later filed as ${formatStatementValue(cell.restated.value, kind)} on ${fmtDate(cell.restated.filed, "medium")}`
    : first;
}

export function StatementsTable({ data, statement, span }: { data: DeskCompanyStatements; statement: DeskStatementName; span: number }) {
  const from = Math.max(0, data.quarters.length - span);
  const quarters = data.quarters.slice(from);
  const rows = data.statements[statement];
  if (!quarters.length || !rows.length) return <div className="desk-empty">The company reported no lines for this statement in the standard data.</div>;
  return (
    <div className="desk-table-wrap scroll" style={{ maxHeight: "none" }}>
      <table className="desk-table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr>
            <th scope="col">Line</th>
            {quarters.map((quarter) => (
              <th key={quarter.end} scope="col" className="num" title={`Quarter ended ${fmtDate(quarter.end, "medium")}${quarter.form ? ` · ${quarter.form}${quarter.filed ? ` filed ${fmtDate(quarter.filed, "medium")}` : ""}` : ""}`}>
                {quarterLabel(quarter)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <th scope="row" style={{ fontWeight: 500, textAlign: "left", whiteSpace: "normal", minWidth: 220 }}>{row.label}</th>
              {row.cells.slice(from).map((cell, index) => (
                <td key={quarters[index].end} className="num" title={cell ? cellProvenance(cell, row.kind) : "Not reported"}>
                  {cell ? (
                    <>
                      {formatStatementValue(cell.value, row.kind)}
                      {cell.restated && <sup className="desk-muted" aria-label="later restated"> r</sup>}
                    </>
                  ) : (
                    <span className="desk-muted">–</span>
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
  const [statement, setStatement] = useState<DeskStatementName>("income");
  const [span, setSpan] = useState<"8" | "20">("8");
  const query = trpc.desk.companyStatements.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const data = query.data;
  return (
    <Card
      className="desk-span-12"
      title="Financial statements"
      subtitle={data
        ? `Quarterly figures as first reported to the SEC · standard fundamentals ${data.standard} · US dollars; per-share lines in dollars`
        : "Quarterly figures as first reported to the SEC"}
      action={data ? (
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <Segmented options={STATEMENTS} value={statement} onChange={setStatement} label="Statement" />
          <Segmented options={SPANS} value={span} onChange={setSpan} label="Quarters shown" />
        </span>
      ) : undefined}
    >
      {query.isLoading ? (
        <Shimmer height={220} />
      ) : query.error ? (
        <div className="desk-empty">The statements could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-empty">No standard statements are built for this company.</div>
      ) : (
        <>
          <StatementsTable data={data} statement={statement} span={Number(span)} />
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            Hover a figure for its filing date and source tag. <sup>r</sup> marks a figure that a later filing changed; the first report is shown.
          </p>
        </>
      )}
    </Card>
  );
}
