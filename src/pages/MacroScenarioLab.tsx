// Shock controls call the same scenario engine as the worker. The UI never
// changes a displayed number without recomputing all company impacts.
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Download, FileCheck2, FlaskConical, Info, SlidersHorizontal } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { buildMacroScenarioReport, type MacroScenarioDefinition, type MacroScenarioReport, type ScenarioChannel } from "../../api/services/macro-scenarios";
import type { PilotEvidenceReport } from "../../api/services/pilot-exposure-evidence";
import type { CompanyExposureReport } from "../../api/services/company-exposure";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";

interface ScenarioBundle {
  report: MacroScenarioReport;
  pilot: PilotEvidenceReport;
  exposure: CompanyExposureReport;
  macroSeries: Record<string, NormalizedMacroPoint[]>;
}
const CHANNELS: ScenarioChannel[] = ["rates", "oil", "usd", "credit"];
const SHOCK_PRESETS: Record<ScenarioChannel, { label: string; value: number }[]> = {
  rates: [{ label: "+50 bp", value: 0.005 }, { label: "+100 bp", value: 0.01 }, { label: "+200 bp", value: 0.02 }],
  oil: [{ label: "+10%", value: 0.10 }, { label: "+20%", value: 0.20 }, { label: "+40%", value: 0.40 }],
  usd: [{ label: "+2.5%", value: 0.025 }, { label: "+5%", value: 0.05 }, { label: "+10%", value: 0.10 }],
  credit: [{ label: "+50 bp", value: 0.005 }, { label: "+100 bp", value: 0.01 }, { label: "+200 bp", value: 0.02 }],
};
const SHOCK_LIMITS: Record<ScenarioChannel, { min: number; max: number; step: number }> = {
  rates: { min: -0.02, max: 0.05, step: 0.001 },
  oil: { min: -0.5, max: 0.9, step: 0.01 },
  usd: { min: -0.2, max: 0.5, step: 0.01 },
  credit: { min: -0.01, max: 0.05, step: 0.001 },
};
let bundleRequest: Promise<ScenarioBundle> | null = null;
function requestBundle(): Promise<ScenarioBundle> {
  if (!bundleRequest) {
    bundleRequest = Promise.all([
      fetch("/reports/macro-scenarios.json", { cache: "no-store" }),
      fetch("/reports/pilot-exposure-evidence.json", { cache: "no-store" }),
      fetch("/reports/company-exposures.json", { cache: "no-store" }),
    ]).then(async ([scenarioResponse, pilotResponse, exposureResponse]) => {
      for (const response of [scenarioResponse, pilotResponse, exposureResponse]) if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
      const [report, pilot, exposure] = await Promise.all([scenarioResponse.json(), pilotResponse.json(), exposureResponse.json()]) as [MacroScenarioReport, PilotEvidenceReport, CompanyExposureReport];
      if (report.schemaVersion !== 1 || !Array.isArray(report.scenarios) || !Array.isArray(pilot.companies) || !Array.isArray(exposure.companies)) throw new Error("Unsupported scenario schema");
      const macroSeries: Record<string, NormalizedMacroPoint[]> = {};
      for (const scenario of report.scenarios) {
        if (!scenario.baseline) continue;
        macroSeries[scenario.baseline.seriesId] = [{ ...scenario.baseline, availablePrecision: "day" }];
      }
      return { report, pilot, exposure, macroSeries };
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
    return buildMacroScenarioReport({ dataMode: bundle.report.dataMode, asOf: bundle.report.asOf, definitions, macroSeries: bundle.macroSeries, pilot: bundle.pilot.companies, exposures: bundle.exposure.companies });
  }, [bundle, shocks]);
  const scenario = report?.scenarios.find((item) => item.channel === channel) ?? null;
  const impacts = useMemo(() => (scenario?.impacts ?? []).filter((impact) => ticker === "ALL" || impact.ticker === ticker), [scenario, ticker]);
  const selectedImpact = ticker === "ALL" ? null : impacts[0] ?? null;
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
            <code>npx tsx worker/macro-fred-fetch.mts --group all<br />npx tsx scripts/build-pilot-exposure-evidence.mts<br />npx tsx scripts/build-company-exposure.mts --universe research-universe-51.json<br />npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro</code>
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
              <div className="scenario-presets">{SHOCK_PRESETS[channel].map((preset) => <button type="button" key={preset.label} className={shocks[channel] === preset.value ? "active" : ""} onClick={() => updateShock(preset.value)}>{preset.label}</button>)}</div>
              <label className="scenario-control-label" htmlFor="scenario-ticker">Company</label>
              <select id="scenario-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)}>
                <option value="ALL">All pilot companies</option>
                {bundle?.pilot.companies.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker}</option>)}
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
                    <div><span> vintage</span><strong>{scenario.baseline.vintageId}</strong></div>
                  </div>
                ) : <p>No baseline is available for this channel.</p>}
              </section>

              <section className="scenario-panel scenario-impact-panel">
                <div className="scenario-panel-heading"><FileCheck2 size={15} /><h2>Company impacts</h2><span>{impacts.length} rows</span></div>
                <div className="scenario-impact-table" role="table" aria-label="Company scenario impacts">
                  <div className="scenario-impact-head" role="row"><span>Company</span><span>Status</span><span>Metric</span><span>Value</span><span>Period</span></div>
                  {impacts.map((impact) => {
                    const first = impact.metrics[0];
                    return (
                      <button type="button" role="row" key={impact.ticker} className={`scenario-impact-row ${ticker === impact.ticker ? "active" : ""}`} onClick={() => setTicker(impact.ticker)}>
                        <span className="scenario-ticker">{impact.ticker}</span>
                        <span className={`scenario-status ${statusClass(impact.status)}`}>{impact.status}</span>
                        <span>{first?.name ?? "not_computable"}</span>
                        <span className="scenario-number-value">{first ? `${money(first.value)} ${first.unit}` : "—"}</span>
                        <span>{first?.periodEnd ?? impact.reasons[0] ?? "—"}</span>
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
                  {selectedImpact.metrics.map((metric) => (
                    <article key={metric.name} className="scenario-evidence-block">
                      <h3>{metric.name} · {metric.impactType}</h3>
                      <p className="scenario-formula">{metric.formula}</p>
                      <dl>
                        <div><dt>Value</dt><dd>{money(metric.value)} {metric.unit}</dd></div>
                        <div><dt>Concepts</dt><dd>{metric.concepts.join(", ") || "—"}</dd></div>
                        <div><dt>Period</dt><dd>{metric.periodStart ? `${metric.periodStart} → ` : ""}{metric.periodEnd ?? "—"}</dd></div>
                        <div><dt>Available</dt><dd>{metric.availableAt ?? "—"}</dd></div>
                        <div><dt>Stale</dt><dd>{metric.stale ? "true · historical only" : "false"}</dd></div>
                      </dl>
                    </article>
                  ))}
                </>
              ) : (
                <>
                  <div className="scenario-reason"><span>Method</span><p>Select a company row to inspect its exact formula, concepts, period and availability. `Upper bound` means hedge share is unknown; `gross_exposure` is not net income.</p></div>
                  <div className="scenario-evidence-block"><h3>Baseline provenance</h3><dl>
                    <div><dt>Source</dt><dd>{scenario.baseline?.sourceUrl ?? "—"}</dd></div>
                    <div><dt>SHA256</dt><dd className="scenario-hash">{scenario.baseline?.sourceHash ?? "—"}</dd></div>
                    <div><dt>Availability basis</dt><dd>{scenario.baseline?.availabilityBasis ?? "—"}</dd></div>
                    <div><dt>Research eligible</dt><dd>{scenario.baseline?.researchEligibleAt ?? "—"}</dd></div>
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
