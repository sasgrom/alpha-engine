import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BookOpenCheck, ExternalLink, FileSearch, Filter, ShieldCheck } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { expectationsReport } from "@/data/expectations-report";
import { expectationReferenceExamples } from "@/data/expectation-reference-examples";
import type { ExpectationReportStatement, ExpectationsReport } from "../../worker/lib/expectations-report";

const report = expectationsReport as unknown as ExpectationsReport;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const unit = (value: ExpectationReportStatement["unit"]) => ({
  usd_billions: "$B", usd_millions: "$M", usd_per_share: "$/share", percent: "%", basis_points: "bps", ratio: "×", days: "d", usd: "$", count: "", text: "", other: "",
}[value]);
const fmt = (value: number) => Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2).replace(/\.00$/, "");

function valueText(statement: ExpectationReportStatement): string {
  const suffix = unit(statement.unit);
  const numberWithUnit = (value: number) => {
    if (statement.unit === "usd_billions") return `$${fmt(value)}B`;
    if (statement.unit === "usd_millions") return `$${fmt(value)}M`;
    if (statement.unit === "usd_per_share") return `$${fmt(value)}`;
    if (statement.unit === "usd") return `$${fmt(value)}`;
    return `${fmt(value)}${suffix}`;
  };
  if (statement.qualifier === "range" && statement.valueLow !== null && statement.valueHigh !== null) return `${numberWithUnit(statement.valueLow)}–${numberWithUnit(statement.valueHigh).replace(/^\$/, "")}`;
  if (statement.qualifier === "plus_minus" && statement.valuePoint !== null) return `${numberWithUnit(statement.valuePoint)} ± ${statement.tolerance ?? "?"}${statement.toleranceUnit === "basis_points" ? " bps" : statement.toleranceUnit === "percent" ? "%" : ` ${suffix}`}`;
  if (statement.qualifier === "at_least" && statement.valueLow !== null) return `≥ ${numberWithUnit(statement.valueLow)}`;
  if (statement.qualifier === "at_most" && statement.valueHigh !== null) return `≤ ${numberWithUnit(statement.valueHigh)}`;
  if (statement.qualifier === "approximately" && statement.valuePoint !== null) return `≈ ${numberWithUnit(statement.valuePoint)}`;
  if (statement.qualifier === "point" && statement.valuePoint !== null) return numberWithUnit(statement.valuePoint);
  if (statement.qualifier === "unchanged") return "Unchanged";
  if (statement.qualifier === "not_provided") return "Not provided";
  return statement.valueText ?? "Qualitative outlook";
}

function basisText(statement: ExpectationReportStatement): string {
  const accounting = statement.basis.replace(/_/g, "-");
  return statement.currencyBasis === "constant_currency" ? `${accounting} · constant currency` : accounting;
}

function statusCopy() {
  if (report.status === "reviewed") return { title: "Reviewed research snapshot", tone: "ok" };
  if (report.status === "partial") return { title: "Local results · review required", tone: "warn" };
  return { title: "Waiting for home extraction", tone: "muted" };
}

export default function Expectations() {
  const [tab, setTab] = useState<"output" | "examples">("output");
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("all");
  const [metric, setMetric] = useState("all");
  const [revision, setRevision] = useState("all");
  const tickers = useMemo(() => [...new Set(report.statements.map((statement) => statement.ticker))].sort(), []);
  const metrics = useMemo(() => [...new Set(report.statements.map((statement) => statement.metricRaw))].sort(), []);
  const revisions = useMemo(() => [...new Set(report.statements.map((statement) => statement.revision))].sort(), []);
  const filtered = useMemo(() => report.statements.filter((statement) => {
    const haystack = `${statement.ticker} ${statement.metricRaw} ${statement.scopeRaw} ${statement.periodRaw} ${statement.evidence}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase()))
      && (ticker === "all" || statement.ticker === ticker)
      && (metric === "all" || statement.metricRaw === metric)
      && (revision === "all" || statement.revision === revision);
  }), [query, ticker, metric, revision]);
  const status = statusCopy();
  const coverage = report.coverage;
  const coverageRate = coverage.companiesExpected ? coverage.companiesWithResults / coverage.companiesExpected : 0;

  return (
    <AppLayout title="Expectations Engine">
      <div className="expectations-page">
        <section className="expectations-hero t-panel">
          <div>
            <div className="t-label"><BookOpenCheck size={14} /> Management guidance · actuals · revisions · evidence</div>
            <h1>Expectations before narrative.</h1>
            <p>A readable map of what management promised, changed and reported — with source evidence and independent extraction QA. This is not a directional trading signal.</p>
          </div>
          <div className="expectations-hero-status">
            <span className={`expectations-status ${status.tone}`}>{status.title}</span>
            <strong>{coverage.companiesWithResults} / {coverage.companiesExpected}</strong>
            <span>companies covered</span>
            <div><Link to="/analytics">Analytics</Link><Link to="/analytics/methodology">Methodology</Link></div>
          </div>
        </section>

        <section className="expectations-metric-grid">
          <div className="t-panel"><span>Documents processed</span><strong>{number.format(coverage.documents)}</strong><small>{coverage.noCandidate} no-candidate · {coverage.unparsed} unparsed · {coverage.failed} failed</small></div>
          <div className="t-panel"><span>Structured statements</span><strong>{number.format(coverage.statements)}</strong><small>Guidance, actuals, assumptions and revisions</small></div>
          <div className="t-panel"><span>Independent benchmark</span><strong>{report.benchmark?.recall !== null && report.benchmark?.recall !== undefined ? `${(report.benchmark.recall * 100).toFixed(1)}%` : "—"}</strong><small>{report.benchmark ? `${report.benchmark.pass ? "PASS" : "REVIEW"} · ${report.benchmark.issueCount} issues` : "Not run"}</small></div>
          <div className="t-panel"><span>Evidence rejected</span><strong>{number.format(coverage.rejectedEvidence)}</strong><small>Unsupported statements removed before display</small></div>
        </section>

        <section className="t-panel expectations-coverage-panel">
          <div><span className="t-label">Company coverage</span><span className="t-mono text-[11px] text-muted-foreground">{(coverageRate * 100).toFixed(1)}%</span></div>
          <div className="expectations-coverage-track"><div style={{ width: `${coverageRate * 100}%` }} /></div>
          <div className="expectations-coverage-foot"><span>Generated {report.generatedAt.slice(0, 16).replace("T", " ")} UTC</span><span>{report.scope}</span></div>
        </section>

        <div className="expectations-tabs" role="tablist" aria-label="Expectations content">
          <button type="button" role="tab" aria-selected={tab === "output"} className={tab === "output" ? "active" : ""} onClick={() => setTab("output")}><FileSearch size={14} /> Extracted report</button>
          <button type="button" role="tab" aria-selected={tab === "examples"} className={tab === "examples" ? "active" : ""} onClick={() => setTab("examples")}><ShieldCheck size={14} /> SEC reference examples</button>
        </div>

        {tab === "output" ? (
          <>
            <section className="t-panel expectations-filters">
              <div className="expectations-search"><Filter size={14} /><input aria-label="Search expectations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, metric, scope or evidence" /></div>
              <select aria-label="Filter ticker" value={ticker} onChange={(event) => setTicker(event.target.value)}><option value="all">All tickers</option>{tickers.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter metric" value={metric} onChange={(event) => setMetric(event.target.value)}><option value="all">All metrics</option>{metrics.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter revision" value={revision} onChange={(event) => setRevision(event.target.value)}><option value="all">All revisions</option>{revisions.map((value) => <option key={value}>{value}</option>)}</select>
              <span className="expectations-filter-count">{filtered.length} statements{filtered.length > 120 ? " · first 120" : ""}</span>
            </section>
            {filtered.length ? (
              <section className="expectations-card-grid">
                {filtered.slice(0, 120).map((statement, index) => (
                  <article className="expectation-card t-panel" key={`${statement.accessionNo}-${statement.ticker}-${index}`}>
                    <header><div><span className="expectation-ticker">{statement.ticker}</span><span className="expectation-form">{statement.form} · {statement.filingDate}</span></div><span className={`expectation-revision ${statement.revision}`}>{statement.revision.replace(/_/g, " ")}</span></header>
                    <div className="expectation-metric">{statement.metricRaw}</div>
                    <div className="expectation-period">{statement.periodRaw} · {statement.scopeRaw}</div>
                    <div className="expectation-value">{valueText(statement)}</div>
                    <div className="expectation-basis">{basisText(statement)}{statement.comparisonRaw ? ` · vs ${statement.comparisonRaw}` : ""}</div>
                    {statement.assumptionRaw && <div className="expectation-assumption"><span>Assumption</span>{statement.assumptionRaw}</div>}
                    <details className="expectation-evidence"><summary>Source evidence</summary><blockquote>{statement.evidence}</blockquote></details>
                    <footer><span>{statement.kind.replace(/_/g, " ")}</span><a href={statement.sourceUrl} target="_blank" rel="noreferrer">SEC filing <ExternalLink size={12} /></a></footer>
                  </article>
                ))}
              </section>
            ) : (
              <section className="t-panel expectations-empty">
                <FileSearch size={24} />
                <h2>{report.statements.length ? "No statements match these filters" : "No extracted statements yet"}</h2>
                <p>{report.statements.length ? "Clear or broaden the filters to inspect the reviewed output." : "Run the bounded 53-company extraction, review the benchmark report, then rebuild this page’s static data. No result is inferred from the reference examples."}</p>
                {!report.statements.length && <code>npx tsx worker/edgar-expectations.mts --universe research-universe-53.json</code>}
              </section>
            )}
          </>
        ) : (
          <section className="expectations-card-grid">
            {expectationReferenceExamples.map((example) => (
              <article className="expectation-card t-panel" key={`${example.ticker}-${example.metric}`}>
                <header><div><span className="expectation-ticker">{example.ticker}</span><span className="expectation-form">Source-reviewed SEC example</span></div><span className="expectation-revision initial">reference</span></header>
                <div className="expectation-metric">{example.metric}</div>
                <div className="expectation-period">{example.period}</div>
                <div className="expectation-value">{example.value}</div>
                <div className="expectation-basis">{example.basis} · {example.revision}</div>
                {example.assumption && <div className="expectation-assumption"><span>Context</span>{example.assumption}</div>}
                <footer><span>Not an accuracy result</span><a href={example.sourceUrl} target="_blank" rel="noreferrer">SEC source <ExternalLink size={12} /></a></footer>
              </article>
            ))}
          </section>
        )}
        <div className="expectations-disclaimer"><ShieldCheck size={14} /><span>Guidance is not consensus. A beat is not automatically bullish, and a large price move is not automatically mispricing. Event studies remain a separate validation layer.</span></div>
      </div>
    </AppLayout>
  );
}
