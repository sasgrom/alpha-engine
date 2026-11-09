/**
 * Quiet ops alert for the owner: reads the local daily operations report and
 * shows a compact banner on the Dashboard when the pipeline is not healthy.
 * Renders NOTHING when the report is ok, missing, unreadable, or a fixture —
 * the absence of this banner is never a health claim.
 */
import { useEffect, useState } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import type { DailyOperationsReport } from "../../worker/lib/daily-operations-report";

export default function OpsStatusBanner() {
  const [report, setReport] = useState<DailyOperationsReport | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/reports/daily-operations.json", { cache: "no-store" });
        if (!response.ok) { if (alive) setReport(null); return; }
        const value = (await response.json()) as DailyOperationsReport;
        if (value.schemaVersion !== 1 || !Array.isArray(value.checks)) { if (alive) setReport(null); return; }
        if (alive) setReport(value);
      } catch { if (alive) setReport(null); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!report || report.status === "ok" || report.dataMode === "fixture") return null;
  const errors = report.summary.checksError;
  const warnings = report.summary.checksWarning;
  const firstError = report.checks.find((check) => check.status === "error");
  const critical = report.status === "critical";
  const tone = critical ? "text-[hsl(var(--crit))] border-[hsl(var(--crit)/0.5)]" : "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.5)]";
  return (
    <Link to="/workers" className={`t-panel mt-4 px-4 py-3 flex items-center gap-3 border ${tone} hover:bg-white/[0.03] transition-colors`}>
      <ShieldAlert size={16} className="shrink-0" />
      <span className="t-mono text-[12px]">
        Operations: {report.status} · {errors} errors · {warnings} warnings
        {firstError ? ` — first: ${firstError.label}` : ""}
        {report.scheduler.status !== "online" ? ` · scheduler ${report.scheduler.status}` : ""}
      </span>
      <ArrowRight size={13} className="ml-auto shrink-0" />
    </Link>
  );
}
