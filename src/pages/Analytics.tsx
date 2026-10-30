import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import AnalyticsNetwork, { type AnalyticsMode, type AnalyticsNode, type AnalyticsStatus } from "@/components/AnalyticsNetwork";
import OptionHypothesisLedger from "@/components/OptionHypothesisLedger";
import ToneCarChart from "@/components/ToneCarChart";
import { analyticsSnapshot } from "@/data/analytics-snapshot";
import { Link } from "react-router";
import { ArrowRight, BookOpen } from "lucide-react";

const statusLabel: Record<AnalyticsStatus, string> = {
  done: "Done",
  partial: "Partial",
  missing: "Missing / unproven",
  blocked: "Blocked",
};
const statusColor: Record<AnalyticsStatus, string> = {
  done: "hsl(var(--ok))",
  partial: "hsl(var(--warn))",
  missing: "hsl(var(--crit))",
  blocked: "hsl(var(--muted-foreground))",
};
const criticalIds = new Set([
  "fullUniverse", "dailyPrices", "pointInTime", "featurePanel", "magnitudeModel", "robustBacktest", "alphaEvidence", "optionsHistory", "shareFlows", "edgarToneQA", "panel", "crossValidation", "probability", "nestedEval", "factorLib",
]);

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="t-panel px-4 py-3">
      <div className="t-label">{label}</div>
      <div className="t-mono text-[24px] leading-tight mt-1 text-foreground">{value}</div>
      {hint && <div className="t-mono text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="t-mono text-[15px] font-semibold tracking-[0.08em] text-foreground">{title}</h2>
      {subtitle && <div className="t-mono text-[11px] text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}

function Detail({ node }: { node: AnalyticsNode | null }) {
  if (!node) return <div className="t-panel px-5 py-4 t-mono text-[12px] text-muted-foreground">Select a node to inspect evidence and the next step.</div>;
  const color = statusColor[node.status];
  return (
    <div className="t-panel px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="t-mono text-[16px] font-semibold text-foreground">{node.title}</h3>
        <span className="t-mono text-[10px] px-2 py-1 rounded-full border" style={{ color, borderColor: color }}>{statusLabel[node.status]}</span>
      </div>
      <p className="t-mono text-[12px] leading-relaxed text-foreground/90 mt-3">{node.detail}</p>
      <p className="t-mono text-[12px] leading-relaxed text-muted-foreground mt-2"><strong className="text-foreground">Next step:</strong> {node.next}</p>
    </div>
  );
}

export default function Analytics() {
  const [mode, setMode] = useState<AnalyticsMode>("actual");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | AnalyticsStatus>("all");
  const [critical, setCritical] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = useMemo((): readonly AnalyticsNode[] => (mode === "actual" ? analyticsSnapshot.actual : analyticsSnapshot.target) as readonly AnalyticsNode[], [mode]);
  const filtered = useMemo(() => nodes.filter((node) => {
    const text = `${node.title} ${node.detail} ${node.next}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (status === "all" || node.status === status) && (!critical || criticalIds.has(node.id));
  }), [nodes, query, status, critical]);
  const selectedNode = nodes.find((node) => node.id === selected) ?? filtered[0] ?? null;
  const counts = useMemo(() => ({
    done: nodes.filter((n) => n.status === "done").length,
    partial: nodes.filter((n) => n.status === "partial").length,
    missing: nodes.filter((n) => n.status === "missing").length,
    blocked: nodes.filter((n) => n.status === "blocked").length,
  }), [nodes]);
  const m = analyticsSnapshot.metrics;
  const history = [...analyticsSnapshot.history].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

  return (
    <AppLayout title="Alpha Analytics">
      <div className="space-y-5">
        <section className="t-panel px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="t-label">Weekly evidence review</div>
              <h1 className="t-mono text-[24px] font-semibold tracking-[0.04em] text-foreground mt-1">Strong engineering. Unproven alpha.</h1>
              <p className="t-mono text-[12px] text-muted-foreground mt-2 max-w-3xl">
                The platform is reliable at collecting and repairing data. It has not yet demonstrated a stable predictive advantage. Do not promote current models to live trading.
              </p>
            </div>
            <div className="t-mono text-[11px] text-muted-foreground text-right">
              <div>{analyticsSnapshot.week}</div>
              <div>Snapshot: {analyticsSnapshot.generatedAt.slice(0, 16).replace("T", " ")} UTC</div>
              <div className="flex flex-wrap gap-3 justify-end">
                <Link to="/analytics/methodology" className="text-live-cyan hover:underline">Methodology</Link>
                <Link to="/analytics/risk-lab" className="text-live-cyan hover:underline">Risk Lab</Link>
                <Link to="/" className="text-live-cyan hover:underline">Back to Mission Control</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Metric label="Registry" value={m.companies.toLocaleString("en-US")} hint="companies" />
          <Metric label="Factor coverage" value={m.factorCompanies.toLocaleString("en-US")} hint="companies with factor_points" />
          <Metric label="EDGAR tone" value={m.edgarToneRows.toLocaleString("en-US")} hint={`${m.edgarToneCompanies} companies`} />
          <Metric label="13F holdings" value={m.fundHoldings.toLocaleString("en-US")} hint={`${m.funds} funds · ${m.fundCompanies} companies`} />
          <Metric label="Position events" value={m.positionEvents.toLocaleString("en-US")} hint="with actual filing dates" />
          <Metric label="Option snapshots" value={m.optionsSnapshots.toLocaleString("en-US")} hint="foundation, not long history" />
        </section>

        <Link to="/analytics/methodology" className="methodology-tile">
          <div className="methodology-tile-main">
            <span className="methodology-tile-icon"><BookOpen size={19} /></span>
            <div>
              <div className="methodology-tile-title">Volatility Lab</div>
              <div className="methodology-tile-subtitle">Notation, expected move, paired baselines and an AAPL risk-profile example</div>
            </div>
          </div>
          <span className="methodology-tile-arrow"><ArrowRight size={20} /></span>
        </Link>

        <section className="t-panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`t-mono text-[11px] px-3 py-2 rounded border ${mode === "actual" ? "border-[hsl(var(--live))] text-[hsl(var(--live))]" : "border-border text-muted-foreground"}`} onClick={() => { setMode("actual"); setSelected(null); }}>Actual state</button>
            <button type="button" className={`t-mono text-[11px] px-3 py-2 rounded border ${mode === "target" ? "border-[hsl(var(--live))] text-[hsl(var(--live))]" : "border-border text-muted-foreground"}`} onClick={() => { setMode("target"); setSelected(null); }}>Path to alpha</button>
            <input aria-label="Search nodes" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search node or task" className="t-mono text-[11px] px-3 py-2 rounded border border-border bg-transparent text-foreground min-w-[190px]" />
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as "all" | AnalyticsStatus)} className="t-mono text-[11px] px-2 py-2 rounded border border-border bg-transparent text-foreground">
              <option value="all">All statuses</option>
              <option value="done">Done</option>
              <option value="partial">Partial</option>
              <option value="missing">Missing / unproven</option>
              <option value="blocked">Blocked</option>
            </select>
            <button type="button" className={`t-mono text-[11px] px-3 py-2 rounded border ${critical ? "border-[hsl(var(--live))] text-[hsl(var(--live))]" : "border-border text-muted-foreground"}`} onClick={() => setCritical((v) => !v)}>{critical ? "Critical path on" : "Critical path off"}</button>
            <span className="t-mono text-[10px] text-muted-foreground ml-auto">{filtered.length} nodes · {counts.done} done · {counts.partial} partial · {counts.missing} missing</span>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          <div className="t-panel p-3 overflow-x-auto">
            <AnalyticsNetwork mode={mode} nodes={filtered} selectedId={selectedNode?.id ?? null} onSelect={(node) => setSelected(node.id)} />
          </div>
          <div className="space-y-4">
            <Detail node={selectedNode} />
            <div className="t-panel px-4 py-3">
              <div className="t-label mb-2">Report and weekly protocol</div>
              <p className="t-mono text-[11px] leading-relaxed text-muted-foreground">
                Run the snapshot builder weekly, review the diff, then publish the new version. Raw archives stay on the large home drive; production gets metrics and normalized features only.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <a href="/reports/project-strength-review.md" target="_blank" rel="noreferrer" className="t-mono text-[11px] px-3 py-2 rounded border border-border text-live-cyan hover:underline">Open the full English review</a>
                <a href="/reports/weekly-metrics.json" target="_blank" rel="noreferrer" className="t-mono text-[11px] px-3 py-2 rounded border border-border text-live-cyan hover:underline">Download metrics JSON</a>
              </div>
            </div>
          </div>
        </section>

        <ToneCarChart />
        <OptionHypothesisLedger />

        <section className="t-panel px-5 py-4">
          <SectionTitle title="Weekly history" subtitle="Real snapshots only. No fabricated trend lines." />
          <div className="overflow-x-auto">
            <table className="w-full t-mono text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Week</th><th className="py-2 pr-4">Generated</th><th className="py-2 pr-4">Factor companies</th><th className="py-2 pr-4">EDGAR tone companies</th><th className="py-2 pr-4">Option snapshots</th><th className="py-2 pr-4">Latest prices</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={row.week} className="border-b border-[hsl(var(--border)/0.45)]">
                    <td className="py-2 pr-4 text-foreground">{row.week}{i === 0 ? " · baseline" : ""}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{row.generatedAt.slice(0, 10)}</td>
                    <td className="py-2 pr-4">{row.metrics.factorCompanies}</td>
                    <td className="py-2 pr-4">{row.metrics.edgarToneCompanies}</td>
                    <td className="py-2 pr-4">{row.metrics.optionsSnapshots}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{row.metrics.latestPriceDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
