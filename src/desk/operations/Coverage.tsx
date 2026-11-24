/**
 * The Coverage tab: the weekly coverage report in short. It counts the rows of the app's main tables against the
 * week before, so a table that stopped growing, shrank or went missing shows at once.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Card, Kpi, Notice, Shimmer, StatusLabel } from "../components";
import { fmtDateTime } from "../format";

interface CoverageTable {
  table: string;
  present: boolean;
  baselinePresent: boolean;
  rows: number | null;
  baselineRows: number | null;
  deltaRows: number | null;
  hashChanged: boolean;
  maxDate: string | null;
}

interface CoverageReport {
  generatedAt: string;
  baselineGeneratedAt: string | null;
  status: string;
  summary: { tables: number; tablesPresent: number; tablesMissing: number; tablesWithRowIncrease: number; tablesWithRowDecrease: number; tablesWithHashDrift: number; rows: number; baselineRows: number; deltaRows: number };
  tables: CoverageTable[];
}

async function fetchCoverage(): Promise<CoverageReport | null> {
  const response = await fetch("/reports/weekly-coverage.json", { cache: "no-store", credentials: "include" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The coverage report answered ${response.status}`);
  return (await response.json()) as CoverageReport;
}

const count = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US"));
/** Missing first, then shrunk, then grown, then unchanged. */
const order = (row: CoverageTable) => (!row.present ? 0 : (row.deltaRows ?? 0) < 0 ? 1 : (row.deltaRows ?? 0) > 0 ? 2 : 3);

export function Coverage() {
  const report = useQuery({ queryKey: ["desk", "weekly-coverage"], queryFn: fetchCoverage, staleTime: 10 * 60_000 });
  if (report.isLoading) return <Shimmer height={320} />;
  if (report.error) return <Notice title="The coverage report could not be read">{(report.error as Error).message}</Notice>;
  if (!report.data) return <Notice title="No coverage report yet">The weekly coverage job has not written one.</Notice>;
  const data = report.data;
  const ageDays = Math.floor((Date.now() - Date.parse(data.generatedAt)) / 86_400_000);
  const rows = [...data.tables].sort((a, b) => order(a) - order(b) || a.table.localeCompare(b.table));

  return (
    <>
      {ageDays > 8 && <Notice title={`This report is ${ageDays} days old`}>It is written once a week. A report older than eight days means the weekly coverage job did not run or did not finish.</Notice>}
      <div className="desk-kpis four">
        <Kpi label="Tables found" value={`${data.summary.tablesPresent} / ${data.summary.tables}`} note={data.summary.tablesMissing ? `${data.summary.tablesMissing} missing` : "none missing"} />
        <Kpi label="Rows" value={count(data.summary.rows)} note={`${data.summary.deltaRows >= 0 ? "+" : "−"}${count(Math.abs(data.summary.deltaRows))} since the report before`} />
        <Kpi label="Tables that grew" value={String(data.summary.tablesWithRowIncrease)} note={`${data.summary.tablesWithRowDecrease} shrank`} />
        <Kpi label="Tables whose content changed" value={String(data.summary.tablesWithHashDrift)} note="rows added, corrected or removed" />
      </div>
      <Card className="desk-span-12" flush title="The app's tables" subtitle={`Report of ${fmtDateTime(data.generatedAt)}${data.baselineGeneratedAt ? `, against ${fmtDateTime(data.baselineGeneratedAt)}` : ""} · gaps first`} action={<a className="desk-button" href="/reports/weekly-coverage.md" target="_blank" rel="noreferrer">Full report <ArrowUpRight size={13} aria-hidden="true" /></a>}>
        <div className="desk-table-wrap">
          <table className="desk-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Table</th><th className="num">Rows</th><th className="num">Change</th><th>Content</th><th>State</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.table} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 560 }}>{row.table}</td>
                  <td className="num">{count(row.rows)}</td>
                  <td className="num">{row.deltaRows === null || row.deltaRows === 0 ? <span className="desk-muted">—</span> : <span className={`desk-num desk-${row.deltaRows > 0 ? "up" : "down"}`}>{row.deltaRows > 0 ? "+" : "−"}{count(Math.abs(row.deltaRows))}</span>}</td>
                  <td className="desk-ink-2">{!row.present ? "—" : row.hashChanged ? "changed" : "same as before"}</td>
                  <td>{!row.present ? <StatusLabel status="error" label="missing" /> : (row.deltaRows ?? 0) < 0 ? <StatusLabel status="warning" label="shrank" /> : <StatusLabel status="ok" label="present" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
