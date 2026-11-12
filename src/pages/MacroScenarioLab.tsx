// Shock controls call the same scenario engine as the worker. The UI never
// changes a displayed number without recomputing all company impacts.
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Download, FileCheck2, FlaskConical, Info, SlidersHorizontal } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { buildMacroScenarioReport, type MacroScenarioDefinition, type MacroScenarioReport, type ScenarioChannel, type ScenarioStatus } from "../../api/services/macro-scenarios";
import type { ShockCalibrationReport } from "../../api/services/shock-calibration";
import type { PilotEvidenceReport } from "../../api/services/pilot-exposure-evidence";
import type { CompanyExposureReport } from "../../api/services/company-exposure";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { ExposureFiling } from "../../worker/lib/exposure-aggregation";
import type { AtlasRecord } from "../../api/services/scenario-rate-atlas";

interface ScenarioBundle {
  report: MacroScenarioReport;
  pilot: PilotEvidenceReport;
  exposure: CompanyExposureReport;
  calibration: ShockCalibrationReport | null;
  macroSeries: Record<string, NormalizedMacroPoint[]>;
  exposureHistory?: ExposureFiling[];
  atlasRecords?: AtlasRecord[];
  atlasAsOf?: string;
}
const CHANNELS: ScenarioChannel[] = ["rates", "oil", "usd", "credit"];
const SHOCK_PRESETS: Record<ScenarioChannel, { label: string; value: number }[]> = {
  rates: [{ label: "+50 bp", value: 0.005 }, { label: "+100 bp", value: 0.01 }, { label: "+200 bp", value: 0.02 }],
  oil: [{ label: "+10%", value: 0.10 }, { label: "+20%", value: 0.20 }, { label: "+40%", value: 0.40 }],
  usd: [{ label: "+2.5%", value: 0.025 }, { label: "+5%", value: 0.05 }, { label: "+10%", value: 0.10 }],
  credit: [{ label: "+50 bp", value: 0.005 }, { label: "+100 bp", value: 0.01 }, { label: "+200 bp", value: 0.02 }],
};
const SHOCK_LIMITS: Record<ScenarioChannel, { min: number; max: number; step: number }> = {
  rates: { min: -0.02, max: 0.05, step: 0.0001 },
  oil: { min: -0.5, max: 0.9, step: 0.01 },
  usd: { min: -0.2, max: 0.5, step: 0.01 },
  credit: { min: -0.01, max: 0.05, step: 0.0001 },
};
let bundleRequest: Promise<ScenarioBundle> | null = null;
function fetchCalibration(): Promise<ShockCalibrationReport | null> {
  return fetch("/reports/shock-calibration.json", { cache: "no-store" })
    .then((response) => response.status === 404 ? null : response.ok ? response.json() as Promise<ShockCalibrationReport> : Promise.reject(new Error(`Calibration HTTP ${response.status}`)))
    .catch(() => null);
}
async function fetchOptionalReport<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
function requestBundle(): Promise<ScenarioBundle> {
  if (!bundleRequest) {
    bundleRequest = Promise.all([
      fetch("/reports/macro-scenarios.json", { cache: "no-store" }),
      fetch("/reports/pilot-exposure-evidence.json", { cache: "no-store" }),
      fetch("/reports/company-exposures.json", { cache: "no-store" }),
      fetchCalibration(),
      fetchOptionalReport<{ companies: ExposureFiling[]; latestMeasures?: ExposureFiling[] }>("/reports/exposure-latest.json"),
      fetchOptionalReport<{ asOf: string; records: AtlasRecord[] }>("/reports/macro-transmission-atlas.json"),
    ]).then(async ([scenarioResponse, pilotResponse, exposureResponse, calibration, history, atlas]) => {
      for (const response of [scenarioResponse, pilotResponse, exposureResponse]) if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
      const [report, pilot, exposure] = await Promise.all([scenarioResponse.json(), pilotResponse.json(), exposureResponse.json()]) as [MacroScenarioReport, PilotEvidenceReport, CompanyExposureReport];
      if (report.schemaVersion !== 1 || !Array.isArray(report.scenarios) || !Array.isArray(pilot.companies) || !Array.isArray(exposure.companies)) throw new Error("Unsupported scenario schema");
      if (history && (!Array.isArray(history.companies) || !Array.isArray(history.latestMeasures))) throw new Error("Unsupported exposure history schema");
      const macroSeries: Record<string, NormalizedMacroPoint[]> = {};
      for (const scenario of report.scenarios) {
        if (!scenario.baseline) continue;
        macroSeries[scenario.baseline.seriesId] = [{ ...scenario.baseline, availablePrecision: "day" }];
      }
      return { report, pilot, exposure, calibration, macroSeries, exposureHistory: history ? [...history.companies, ...(history.latestMeasures ?? [])] : undefined, atlasRecords: atlas?.records, atlasAsOf: atlas?.asOf };
    }).catch((error: unknown) => { bundleRequest = null; throw error; });
  }
  return bundleRequest;
}
const money = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
};
const shockText = (channel: ScenarioChannel, value: number) => channel === "rates" || channel === "credit" ? `${value >= 0 ? "+" : ""}${(value * 10_000).toFixed(0)} bp` : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}%`;
function statusClass(status: string): string {
  return status === "computable" ? "scenario-status-ok" : status === "historical_only" ? "scenario-status-stale" : status === "not_computable" ? "scenario-status-missing" : "scenario-status-partial";
}

export default function MacroScenarioLab() {
  const [bundle, setBundle] = useState<ScenarioBundle | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [channel, setChannel] = useState<ScenarioChannel>("rates");
  const [ticker, setTicker] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ScenarioStatus>("ALL");
  const [shocks, setShocks] = useState<Record<ScenarioChannel, number>>({ rates: 0.01, oil: 0.20, usd: 0.05, credit: 0.01 });
  useEffect(() => {
    let active = true;
    void requestBundle()
      .then((value) => {
        if (!active) return;
        setBundle(value);
        setShocks(Object.fromEntries(value.report.scenarios.map((scenario) => [scenario.channel, scenario.shock])) as Record<ScenarioChannel, number>);
        setLoadStatus("ready");
      })
      .catch(() => { if (active) setLoadStatus("error"); });
    return () => { active = false; };
  }, []);
  const report = useMemo<MacroScenarioReport | null>(() => {
    if (!bundle) return null;
    const definitions: MacroScenarioDefinition[] = CHANNELS.map((item) => ({ channel: item, shock: shocks[item] }));
    return buildMacroScenarioReport({ dataMode: bundle.report.dataMode, asOf: bundle.report.asOf, definitions, macroSeries: bundle.macroSeries, pilot: bundle.pilot.companies, exposures: bundle.exposure.companies, exposureHistory: bundle.exposureHistory, atlasRecords: bundle.atlasRecords, atlasAsOf: bundle.atlasAsOf });
  }, [bundle, shocks]);
  const scenario = report?.scenarios.find((item) => item.channel === channel) ?? null;
  const impacts = useMemo(() => (scenario?.impacts ?? []).filter((impact) =>
    (ticker === "ALL" || impact.ticker === ticker) && (statusFilter === "ALL" || impact.status === statusFilter),
  ), [scenario, ticker, statusFilter]);
  const selectedImpact = ticker === "ALL" ? null : scenario?.impacts.find((impact) => impact.ticker === ticker) ?? null;
  const coverage = useMemo(() => {
    const rows = scenario?.impacts ?? [];
    return {
      total: rows.length,
      current: rows.filter((impact) => impact.status === "computable").length,
      historical: rows.filter((impact) => impact.status === "historical_only").length,
      missing: rows.filter((impact) => impact.status === "not_computable").length,
      upperBounds: rows.reduce((total, impact) => total + impact.metrics.filter((metric) => metric.impactType === "upper_bound").length, 0),
    };
  }, [scenario]);
  const channelSeries: Record<ScenarioChannel, string> = { rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" };
  const calibration = bundle?.calibration?.calibrations.find((item) => item.seriesId === channelSeries[channel] && item.status === "ready") ?? null;
  const presets = calibration?.presets
    ? [
        { label: `Mild p${calibration.presets.mild.percentile}`, value: calibration.presets.mild.shock },
        { label: `Severe p${calibration.presets.severe.percentile}`, value: calibration.presets.severe.shock },
        { label: `Extreme p${calibration.presets.extreme.percentile}`, value: calibration.presets.extreme.shock },
      ]
    : SHOCK_PRESETS[channel];
  const updateShock = (value: number) => {
    const limits = SHOCK_LIMITS[channel];
    setShocks((current) => ({ ...current, [channel]: Math.max(limits.min, Math.min(limits.max, Number.isFinite(value) ? value : 0)) }));
  };
  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `macro-scenario-${channel}-${shockText(channel, shocks[channel]).replace(" ", "")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout title="Scenario Lab">
      <div className="scenario-page">
        <section className="scenario-hero">
          <div>
            <div className="t-label"><FlaskConical size={14} /> Availability-anchored macro scenarios</div>
            <h1>Shock the inputs. Inspect the evidence.</h1>
            <p>Upper bounds and gross exposure are not profit forecasts. Every number is recomputed locally from FRED baselines and SEC exposure evidence.</p>
          </div>
          <div className="scenario-hero-status">
            <span className={loadStatus === "error" ? "scenario-status-missing" : "scenario-status-ok"}>{loadStatus === "loading" ? "Loading evidence" : loadStatus === "error" ? "Evidence unavailable" : report?.dataMode === "fixture" ? "Fixture baseline" : "Live SEC + FRED"}</span>
            <strong>{scenario ? shockText(channel, shocks[channel]) : "—"}</strong>
            <span>{scenario?.status ?? "not_computable"}</span>
          </div>
        </section>

        {loadStatus === "error" && (
          <section className="t-panel scenario-empty">
            <AlertTriangle size={22} />
            <h2>Scenario evidence is unavailable</h2>
            <p>Build the FRED archive, pilot evidence and company exposure reports first. No scenario state is inferred from missing files.</p>
            <code>npx tsx scripts/build-pilot-exposure-evidence.mts --source db --universe research-universe-50.json<br />npx tsx scripts/build-company-exposure.mts --universe research-universe-50.json --pilot-evidence public/reports/pilot-exposure-evidence.json<br />npx tsx scripts/build-exposure-history.mts<br />npx tsx scripts/build-macro-transmission-atlas.mts<br />npx tsx scripts/build-macro-scenarios.mts --macro-source file --macro-root D:\research\alpha-engine\macro</code>
          </section>
        )}

        {loadStatus !== "error" && scenario && report && (
          <div className="scenario-layout">
            <aside className="scenario-controls scenario-panel">
              <div className="scenario-panel-heading"><SlidersHorizontal size={15} /><h2>Shock controls</h2></div>
              <div className="scenario-channel-nav" role="tablist" aria-label="Scenario channels">
                {CHANNELS.map((item) => <button key={item} type="button" role="tab" aria-selected={channel === item} className={channel === item ? "active" : ""} onClick={() => setChannel(item)}>{item.toUpperCase()}<span>{shockText(item, shocks[item])}</span></button>)}
              </div>
              <label className="scenario-control-label" htmlFor="scenario-shock">Custom shock · {shockText(channel, shocks[channel])}</label>
              <input id="scenario-shock" className="scenario-slider" type="range" min={SHOCK_LIMITS[channel].min} max={SHOCK_LIMITS[channel].max} step={SHOCK_LIMITS[channel].step} value={shocks[channel]} onChange={(event) => updateShock(Number(event.target.value))} />
              <input className="scenario-number" aria-label="Shock value" type="number" min={SHOCK_LIMITS[channel].min} max={SHOCK_LIMITS[channel].max} step={SHOCK_LIMITS[channel].step} value={shocks[channel]} onChange={(event) => updateShock(Number(event.target.value))} />
              <div className="scenario-presets">{presets.map((preset) => <button type="button" key={preset.label} className={shocks[channel] === preset.value ? "active" : ""} onClick={() => updateShock(preset.value)}>{preset.label}</button>)}</div>
              <div className="scenario-preset-source">{calibration?.presets ? `Calibrated from FRED daily changes · as of ${bundle?.calibration?.asOf.slice(0, 10) ?? "unknown"}` : "Illustrative presets · build shock calibration for historical presets"}</div>
              <label className="scenario-control-label" htmlFor="scenario-ticker">Company</label>
              <select id="scenario-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)}>
                <option value="ALL">All {bundle?.pilot.companies.length ?? 0} companies</option>
                {bundle?.pilot.companies.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker}</option>)}
              </select>
              <label className="scenario-control-label" htmlFor="scenario-status-filter">Evidence status</label>
              <select id="scenario-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | ScenarioStatus)}>
                <option value="ALL">All statuses</option>
                <option value="computable">Current · computable</option>
                <option value="historical_only">Historical only</option>
                <option value="not_applicable">Not applicable · interest margin</option>
                <option value="not_computable">Not computable</option>
              </select>
              <button type="button" className="scenario-download" onClick={download}><Download size={14} /> Export current JSON</button>
              <div className="scenario-control-note"><Info size={13} /><p>Shocks are assumptions, not FRED forecasts. Rate and credit values are decimal rates; oil and USD values are decimal percentages.</p></div>
            </aside>

            <main className="scenario-main">
              <section className="scenario-baseline scenario-panel">
                <div className="scenario-panel-heading"><Activity size={15} /><h2>{channel.toUpperCase()} baseline → scenario</h2></div>
                {scenario.baseline ? (
                  <div className="scenario-baseline-grid">
                    <div><span>FRED series</span><strong>{scenario.baseline.seriesId}</strong></div>
                    <div><span>Baseline</span><strong>{scenario.baseline.value} {scenario.baseline.unit}</strong></div>
                    <div><span>Scenario</span><strong>{scenario.baseline.scenarioValue} {scenario.baseline.unit}</strong></div>
                    <div><span>Observation</span><strong>{scenario.baseline.observationPeriod}</strong></div>
                    <div><span>Available</span><strong>{scenario.baseline.availableAt.slice(0, 10)}</strong></div>
                    <div><span>Vintage</span><strong>{scenario.baseline.vintageId}</strong></div>
                    <div><span>Provenance</span><strong>{scenario.baseline.provenance ?? "official_normalized_archive"}</strong></div>
                  </div>
                ) : <p>No baseline is available for this channel.</p>}
              </section>

              <section className="scenario-coverage" aria-label="Scenario evidence coverage">
                <div><strong>{coverage.current}/{coverage.total}</strong><span>current computable</span></div>
                <div><strong>{coverage.historical}</strong><span>historical only</span></div>
                <div><strong>{coverage.missing}</strong><span>not computable</span></div>
                <div><strong>{coverage.upperBounds}</strong><span>explicit upper bounds</span></div>
              </section>

              <section className="scenario-panel scenario-impact-panel">
                <div className="scenario-panel-heading"><FileCheck2 size={15} /><h2>Company impacts</h2><span>{impacts.length} shown · {coverage.total} total</span></div>
                <div className="scenario-impact-table" role="table" aria-label="Company scenario impacts">
                  <div className="scenario-impact-head" role="row"><span>Company</span><span>Status</span><span>Metric</span><span>Value</span><span>Period</span><span>Measured response</span></div>
                  {impacts.map((impact) => {
                    const first = impact.metrics[0];
                    const measured = impact.measuredResponse;
                    return (
                      <button type="button" role="row" key={impact.ticker} className={`scenario-impact-row ${ticker === impact.ticker ? "active" : ""}`} onClick={() => setTicker(impact.ticker)}>
                        <span className="scenario-ticker">{impact.ticker}</span>
                        <span className={`scenario-status ${statusClass(impact.status)}`}>{impact.status}</span>
                        <span>{first?.name ?? impact.status}{first && <small className="scenario-impact-type">{first.impactType}</small>}</span>
                        <span className="scenario-number-value">{first ? first.unit === "ratio" ? `${(first.value * 100).toFixed(3)}%` : `${money(first.value)} ${first.unit}` : "—"}</span>
                        <span>{first?.periodEnd ?? impact.reasons[0] ?? "—"}</span>
                        <span>{measured?.status === "available" ? `${((measured.median ?? 0) * 100).toFixed(2)}%` : "—"}<small className="scenario-impact-type">{measured?.status === "available" ? measured.disagreement ?? "descriptive only" : measured?.reason ?? "not provided"}</small></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </main>

            <aside className="scenario-evidence scenario-panel">
              <div className="scenario-panel-heading"><Info size={15} /><h2>Evidence inspector</h2></div>
              {selectedImpact ? (
                <>
                  <div className="scenario-inspector-title"><strong>{selectedImpact.ticker}</strong><span className={`scenario-status ${statusClass(selectedImpact.status)}`}>{selectedImpact.status}</span></div>
                  {selectedImpact.reasons.length > 0 && <div className="scenario-reason"><span>Reason</span><p>{selectedImpact.reasons.join(" · ")}</p></div>}
                  {selectedImpact.measuredResponse && <article className="scenario-evidence-block"><h3>Measured market response</h3>
                    {selectedImpact.measuredResponse.status === "available" ? <dl>
                      <div><dt>Median / shock</dt><dd>{((selectedImpact.measuredResponse.median ?? 0) * 100).toFixed(3)}%</dd></div>
                      <div><dt>p05 … p95</dt><dd>{selectedImpact.measuredResponse.interval?.map(value => `${(value * 100).toFixed(3)}%`).join(" … ")}</dd></div>
                      <div><dt>Observations</dt><dd>{selectedImpact.measuredResponse.count} · horizons {selectedImpact.measuredResponse.horizons?.join(", ")} trading days</dd></div>
                      <div><dt>Atlas exposure</dt><dd>{selectedImpact.measuredResponse.exposureKinds?.join(", ")}</dd></div>
                      <div><dt>Comparison</dt><dd>{selectedImpact.measuredResponse.disagreement ?? "No filing direction to compare"}</dd></div>
                    </dl> : <p className="scenario-formula">Unavailable: {selectedImpact.measuredResponse.reason}.</p>}
                    {selectedImpact.measuredResponse.note && <p className="scenario-formula">{selectedImpact.measuredResponse.note}</p>}
                  </article>}
                  {selectedImpact.metrics.map((metric) => (
                    <article key={`${metric.name}-${metric.unit}`} className="scenario-evidence-block">
                      <h3>{metric.name} · {metric.impactType}</h3>
                      <p className="scenario-formula">{metric.formula}</p>
                      <dl>
                        <div><dt>Value</dt><dd>{metric.unit === "ratio" ? `${(metric.value * 100).toFixed(3)}%` : `${money(metric.value)} ${metric.unit}`}</dd></div>
                        <div><dt>Concepts</dt><dd>{metric.concepts.join(", ") || "—"}</dd></div>
                        <div><dt>Period</dt><dd>{metric.periodStart ? `${metric.periodStart} → ` : ""}{metric.periodEnd ?? "—"}</dd></div>
                        <div><dt>Available</dt><dd>{metric.availableAt ?? "—"}</dd></div>
                        <div><dt>Stale</dt><dd>{metric.stale ? "true · historical only" : "false"}</dd></div>
                      </dl>
                    </article>
                  ))}
                  {selectedImpact.exposureEvidence?.map(filing => <article key={filing.accessionNo} className="scenario-evidence-block">
                    <h3>SEC {filing.form} · {filing.filingDate}</h3>
                    <dl><div><dt>Accession</dt><dd>{filing.accessionNo}</dd></div><div><dt>Source</dt><dd>{filing.sourceUrl ? <a href={filing.sourceUrl} target="_blank" rel="noreferrer">Cached primary filing</a> : "Cached primary filing"}</dd></div><div><dt>SHA256</dt><dd className="scenario-hash">{filing.sourceHash ?? "—"}</dd></div></dl>
                    {filing.measures.map(measure => <div key={measure.kind}><p className="scenario-formula"><strong>{measure.kind}</strong> · {measure.unit === "ratio" ? `${(measure.value * 100).toFixed(3)}%` : `${money(measure.value)} ${measure.unit}`} · {measure.note}</p>
                      {measure.facts.map(fact => <details key={fact.id}><summary>{fact.id} · {fact.concept} · {fact.rawValue} {fact.unitRef} · scale {fact.scale ?? "0"}</summary><pre className="scenario-fact">{fact.excerpt}</pre></details>)}
                    </div>)}
                  </article>)}
                </>
              ) : (
                <>
                  <div className="scenario-reason"><span>Method</span><p>Select a company row to inspect its exact formula, concepts, period and availability. Upper bounds may use total debt when the rate split is unknown or scheduled twelve-month maturities for credit. They are not earnings forecasts; gross_exposure is not net income.</p></div>
                  <div className="scenario-evidence-block"><h3>Baseline provenance</h3><dl>
                    <div><dt>Source</dt><dd>{scenario.baseline?.sourceUrl ?? "—"}</dd></div>
                    <div><dt>Transport</dt><dd>{scenario.baseline?.provenance ?? "official_normalized_archive"}</dd></div>
                    <div><dt>SHA256</dt><dd className="scenario-hash">{scenario.baseline?.sourceHash ?? "—"}</dd></div>
                    <div><dt>Availability basis</dt><dd>{scenario.baseline?.availabilityBasis ?? "—"}</dd></div>
                    <div><dt>Research eligible</dt><dd>{scenario.baseline?.researchEligibleAt ?? "—"}</dd></div>
                    {calibration?.distributions["1"] && <>
                      <div><dt>p50 / p90 / p99</dt><dd>{calibration.distributions["1"].p50} / {calibration.distributions["1"].p90} / {calibration.distributions["1"].p99}</dd></div>
                      <div><dt>p50 CI95</dt><dd>{calibration.distributions["1"].ci95P50?.join(" … ")}</dd></div>
                      <div><dt>p90 CI95</dt><dd>{calibration.distributions["1"].ci95P90?.join(" … ")}</dd></div>
                    </>}
                  </dl></div>
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
