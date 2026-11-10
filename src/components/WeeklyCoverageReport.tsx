import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, FileDown, RefreshCw } from "lucide-react";

interface CoverageRow {
  table: string;
  present: boolean;
  rows: number | null;
  baselineRows: number | null;
  deltaRows: number | null;
  hashChanged: boolean;
  maxDate: string | null;
}
interface WeeklyCoverage {
  schemaVersion: 1;
  generatedAt: string;
  baselineGeneratedAt: string | null;
  status: string;
  summary: {
    tables: number;
    tablesPresent: number;
    tablesMissing: number;
    tablesWithRowIncrease: number;
    tablesWithRowDecrease: number;
    tablesWithHashDrift: number;
    rows: number;
    baselineRows: number;
    deltaRows: number;
  };
  tables: CoverageRow[];
}

const BUILD_COMMAND = "npx tsx scripts/build-weekly-coverage.mts";
const timeText = (value: string | null) => value ? value.slice(0, 19).replace("T", " ") + " UTC" : "—";

export default function WeeklyCoverageReportView() {
  const [report, setReport] = useState<WeeklyCoverage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/reports/weekly-coverage.json", { cache: "no-store" });
      if (response.status === 404) { setReport(null); setState("missing"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json() as WeeklyCoverage;
      if (value.schemaVersion !== 1 || !Array.isArray(value.tables) || !value.summary) throw new Error("Unsupported report schema");
      setReport(value);
      setState("ready");
    } catch { setReport(null); setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state !== "ready" || !report) {
    return <section className="t-panel daily-report-empty">
      {state === "loading" ? <Activity size={22} /> : <AlertTriangle size={22} />}
      <h2>{state === "loading" ? "Loading weekly coverage" : "No weekly coverage report"}</h2>
      <p>{state === "error" ? "The report could not be read. Rebuild it from actual inventory snapshots." : "Build the report to compare row counts, content hashes and latest dates per table."}</p>
      <div className="ops-command"><code>{BUILD_COMMAND}</code></div>
      {state !== "loading" && <button type="button" className="ops-icon-button" onClick={() => { setState("loading"); void load(); }}><RefreshCw size={13} />Retry</button>}
    </section>;
  }

  return <div className="weekly-coverage">
    <section className="t-panel daily-report-heading">
      <div>
        <span className="t-label">Weekly coverage · {report.status}</span>
        <h2>Coverage and content drift</h2>
        <p>Generated {timeText(report.generatedAt)} · baseline {timeText(report.baselineGeneratedAt)}</p>
      </div>
      <div className="daily-report-actions">
        <button type="button" className="ops-icon-button" onClick={() => void load()}><RefreshCw size={13} />Refresh</button>
        <a className="ops-icon-button" href="/reports/weekly-coverage.md" download><FileDown size={13} />Markdown</a>
      </div>
    </section>
    <section className="operations-metrics">
      <div className="t-panel"><span>Rows</span><strong>{report.summary.rows.toLocaleString("en-US")}</strong><small>{report.summary.deltaRows >= 0 ? "+" : ""}{report.summary.deltaRows.toLocaleString("en-US")} vs baseline</small></div>
      <div className="t-panel"><span>Tables present</span><strong>{report.summary.tablesPresent}/{report.summary.tables}</strong><small>{report.summary.tablesMissing} missing</small></div>
      <div className="t-panel"><span>Hash drift</span><strong>{report.summary.tablesWithHashDrift}</strong><small>content SHA256 changed</small></div>
      <div className="t-panel"><span>Row increases</span><strong>{report.summary.tablesWithRowIncrease}</strong><small>{report.summary.tablesWithRowDecrease} decreases</small></div>
    </section>
    <section className="t-panel daily-inventory">
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Table</th><th>Rows</th><th>Baseline</th><th>Delta</th><th>Hash</th><th>Max date</th></tr></thead><tbody>
        {report.tables.map((row) => <tr key={row.table}><td>{row.table}</td><td>{row.rows?.toLocaleString("en-US") ?? "—"}</td><td>{row.baselineRows?.toLocaleString("en-US") ?? "—"}</td><td>{row.deltaRows === null ? "—" : `${row.deltaRows > 0 ? "+" : ""}${row.deltaRows.toLocaleString("en-US")}`}</td><td>{row.hashChanged ? "changed" : "same"}</td><td>{row.maxDate ?? "—"}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
