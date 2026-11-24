/**
 * The scenario view of the Macro page: choose a shock to rates, oil, the dollar or credit spreads and see what each
 * company's own filings say it would cost, with the evidence behind every figure. The figures are recomputed here by
 * the same engine that builds the scenario report (api/services/macro-scenarios), so a custom shock and the built
 * report can never disagree. Upper bounds and gross exposures, not forecasts.
 */
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { buildMacroScenarioReport, type CompanyScenarioImpact, type MacroScenarioReport, type ScenarioChannel, type ScenarioStatus } from "../../../../api/services/macro-scenarios";
import type { CompanyExposureReport } from "../../../../api/services/company-exposure";
import type { PilotEvidenceReport } from "../../../../api/services/pilot-exposure-evidence";
import type { AtlasRecord } from "../../../../api/services/scenario-rate-atlas";
import type { ShockCalibrationReport } from "../../../../api/services/shock-calibration";
import type { ExposureFiling } from "../../../../worker/lib/exposure-aggregation";
import type { NormalizedMacroPoint } from "../../../../worker/lib/fred";
import { Card, CompanyLink, Kpi, Segmented, Shimmer } from "../../components";
import { findCompany, useDeskSnapshot, useReport } from "../../data";
import { DeskDialog } from "../../DeskDialog";
import { fmtCap, fmtDate, fmtNum, fmtPct } from "../../format";

const CHANNELS: ScenarioChannel[] = ["rates", "oil", "usd", "credit"];
const CHANNEL_LABEL: Record<ScenarioChannel, string> = { rates: "Rates", oil: "Oil", usd: "Dollar", credit: "Credit spreads" };
const SERIES: Record<ScenarioChannel, string> = { rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" };
const SERIES_LABEL: Record<string, string> = { DGS10: "10-year Treasury yield", DCOILWTICO: "WTI crude oil", DTWEXBGS: "Broad dollar index", BAMLH0A0HYM2: "High-yield spread" };
/** Rates and credit spreads move in basis points, oil and the dollar in percent. */
const inPoints = (channel: ScenarioChannel) => channel === "rates" || channel === "credit";
const perUnit = (channel: ScenarioChannel) => (inPoints(channel) ? 10_000 : 100);
const LIMITS: Record<ScenarioChannel, { min: number; max: number }> = { rates: { min: -0.02, max: 0.05 }, oil: { min: -0.5, max: 0.9 }, usd: { min: -0.2, max: 0.5 }, credit: { min: -0.01, max: 0.05 } };
const ROUND: Record<ScenarioChannel, number[]> = { rates: [0.005, 0.01, 0.02], oil: [0.1, 0.2, 0.4], usd: [0.025, 0.05, 0.1], credit: [0.005, 0.01, 0.02] };
export const shockText = (channel: ScenarioChannel, value: number) => {
  const size = value * perUnit(channel);
  const digits = Number.isInteger(Math.round(size * 10) / 10) ? 0 : 1;
  return `${value < 0 ? "−" : "+"}${Math.abs(size).toFixed(digits)}${inPoints(channel) ? " bp" : "%"}`;
};

const STATUS_LABEL: Record<string, string> = { computable: "Computed", historical_only: "Old evidence only", not_applicable: "Not applicable", not_computable: "No figure", partial: "Partly computed" };
const METRIC_LABEL: Record<string, string> = {
  interest_upper_bound: "Interest cost a year, at most",
  credit_refinancing_upper_bound: "Refinancing cost a year, at most",
  fuel_cost_gross: "Fuel cost, before hedges",
  oil_revenue_gross: "Oil revenue, before hedges",
  usd_translation_elasticity: "Revenue translated into dollars",
};
/** "hedge_share_unknown_upper_bound" → "Hedge share unknown upper bound". */
const sentence = (code: string) => { const text = code.replaceAll("_", " "); return text.charAt(0).toUpperCase() + text.slice(1); };
const signedMoney = (value: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${fmtCap(Math.abs(value)).replace("—", "$0")}`;
function metricValue(metric: CompanyScenarioImpact["metrics"][number]): string {
  if (metric.unit === "ratio") return fmtPct(metric.value, Math.abs(metric.value) < 0.01 ? 2 : 1);
  return `${signedMoney(metric.value)}${metric.unit === "USD/year" ? " a year" : ""}`;
}

interface Bundle {
  report: MacroScenarioReport;
  pilot: PilotEvidenceReport;
  exposure: CompanyExposureReport;
  calibration: ShockCalibrationReport | null;
  history: ExposureFiling[] | undefined;
  atlas: { asOf: string; records: AtlasRecord[] } | null;
}

function Evidence({ impact, channel, shock, onClose }: { impact: CompanyScenarioImpact; channel: ScenarioChannel; shock: number; onClose: () => void }) {
  const measured = impact.measuredResponse;
  return (
    <DeskDialog title={`${impact.ticker}: ${CHANNEL_LABEL[channel].toLowerCase()} ${shockText(channel, shock)}`} onClose={onClose} wide>
      <div className="desk-scenario-evidence">
        <p className="desk-ink-2" style={{ margin: 0, fontSize: 13 }}>
          <strong>{STATUS_LABEL[impact.status] ?? impact.status}.</strong>{impact.reasons.length ? ` ${impact.reasons.map(sentence).join(" · ")}.` : ""}
        </p>
        {impact.metrics.map((metric) => (
          <section key={`${metric.name}|${metric.unit}`}>
            <h3>{METRIC_LABEL[metric.name] ?? sentence(metric.name)}{metric.unit === "ratio" && metric.name.includes("upper_bound") ? ", as a share of operating income" : ""}: {metricValue(metric)}</h3>
            <p className="desk-muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>{metric.impactType === "upper_bound" ? "An upper bound, not a forecast." : "Gross exposure, before hedges and pass-through; not profit."} {metric.formula}</p>
            <dl>
              <div><dt>Period</dt><dd>{metric.periodStart ? `${fmtDate(metric.periodStart, "medium")} to ` : ""}{metric.periodEnd ? fmtDate(metric.periodEnd, "medium") : "—"}{metric.stale ? " · old evidence" : ""}</dd></div>
              <div><dt>Known since</dt><dd>{metric.availableAt ? fmtDate(metric.availableAt.slice(0, 10), "medium") : "—"}</dd></div>
              <div><dt>Filed concepts</dt><dd>{metric.concepts.join(", ") || "—"}</dd></div>
            </dl>
          </section>
        ))}
        {measured && (
          <section>
            <h3>How the share has reacted to such moves</h3>
            {measured.status === "available" ? (
              <>
                <p className="desk-ink-2" style={{ fontSize: 13, margin: "4px 0 8px" }}>
                  Median reaction per unit of the move, scaled in a straight line to this move: <strong>{fmtPct((measured.median ?? 0) * shock, 2)}</strong>, over {measured.count} past observations at horizons of {measured.horizons?.join(", ")} sessions
                  {measured.interval ? `; nine in ten fell between ${fmtPct(measured.interval[0] * shock, 1)} and ${fmtPct(measured.interval[1] * shock, 1)}` : ""}.
                </p>
                <p className="desk-muted" style={{ fontSize: 12.5, margin: 0 }}>{measured.disagreement ? `Against the filing figure: ${sentence(measured.disagreement).toLowerCase()}. ` : ""}{measured.note}</p>
              </>
            ) : (
              <p className="desk-muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>Not measured: {sentence(measured.reason ?? "no reason given").toLowerCase()}.</p>
            )}
          </section>
        )}
        {(impact.exposureEvidence ?? []).map((filing) => (
          <section key={filing.accessionNo}>
            <h3>{filing.form} filed {fmtDate(filing.filingDate, "medium")}</h3>
            <p className="desk-muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
              {filing.sourceUrl ? <a className="desk-link" href={filing.sourceUrl} target="_blank" rel="noreferrer">The filing at the SEC</a> : "Cached filing"} · accession {filing.accessionNo}
            </p>
            {filing.measures.map((measure) => (
              <div key={measure.kind} style={{ marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 13 }}><strong>{sentence(measure.kind.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase())}</strong>: {measure.unit === "ratio" ? fmtPct(measure.value, 1, false) : fmtCap(measure.value)}{measure.note ? ` · ${measure.note}` : ""}</p>
                {measure.facts.map((fact) => (
                  <details key={fact.id}>
                    <summary>{fact.concept} · {fact.rawValue} {fact.unitRef}{fact.scale && fact.scale !== "0" ? ` · scale ${fact.scale}` : ""}</summary>
                    <pre>{fact.excerpt}</pre>
                  </details>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </DeskDialog>
  );
}

export default function MacroScenarios() {
  const snapshot = useDeskSnapshot();
  const scenarios = useReport<MacroScenarioReport>("macro-scenarios.json");
  const pilot = useReport<PilotEvidenceReport>("pilot-exposure-evidence.json");
  const exposure = useReport<CompanyExposureReport>("company-exposures.json");
  const calibrationReport = useReport<ShockCalibrationReport>("shock-calibration.json");
  const history = useReport<{ companies: ExposureFiling[]; latestMeasures?: ExposureFiling[] }>("exposure-latest.json");
  const atlas = useReport<{ asOf: string; records: AtlasRecord[] }>("macro-transmission-atlas.json");
  const [channel, setChannel] = useState<ScenarioChannel>("rates");
  const [custom, setCustom] = useState<Partial<Record<ScenarioChannel, number>>>({});
  const [status, setStatus] = useState<"all" | ScenarioStatus>("all");
  const [open, setOpen] = useState<string | null>(null);

  const loading = [scenarios, pilot, exposure, calibrationReport, history, atlas].some((query) => query.isLoading);
  const failed = [scenarios, pilot, exposure].find((query) => query.error)?.error as Error | undefined;
  const bundle = useMemo<Bundle | null>(() => {
    if (loading || !scenarios.data || !pilot.data || !exposure.data) return null;
    return {
      report: scenarios.data, pilot: pilot.data, exposure: exposure.data, calibration: calibrationReport.data ?? null,
      history: history.data ? [...history.data.companies, ...(history.data.latestMeasures ?? [])] : undefined, atlas: atlas.data ?? null,
    };
  }, [loading, scenarios.data, pilot.data, exposure.data, calibrationReport.data, history.data, atlas.data]);
  // every channel starts at the shock of the built report; a custom shock replaces it for its channel
  const shocks = useMemo(() => Object.fromEntries(CHANNELS.map((item) => [item, custom[item] ?? bundle?.report.scenarios.find((scenario) => scenario.channel === item)?.shock ?? ROUND[item][1]])) as Record<ScenarioChannel, number>, [custom, bundle]);
  const report = useMemo<MacroScenarioReport | null>(() => {
    if (!bundle) return null;
    const macroSeries: Record<string, NormalizedMacroPoint[]> = {};
    for (const scenario of bundle.report.scenarios) if (scenario.baseline) macroSeries[scenario.baseline.seriesId] = [{ ...scenario.baseline, availablePrecision: "day" }];
    return buildMacroScenarioReport({
      dataMode: bundle.report.dataMode, asOf: bundle.report.asOf, definitions: CHANNELS.map((item) => ({ channel: item, shock: shocks[item] })), macroSeries,
      pilot: bundle.pilot.companies, exposures: bundle.exposure.companies, exposureHistory: bundle.history, atlasRecords: bundle.atlas?.records, atlasAsOf: bundle.atlas?.asOf,
    });
  }, [bundle, shocks]);

  if (loading) return <Shimmer height={420} />;
  if (failed) return <div className="desk-card desk-empty">The scenario evidence could not be loaded: {failed.message}</div>;
  if (!bundle || !report) return <div className="desk-card desk-empty">The scenario reports have not been built. They come from the exposure, calibration and scenario builders of the evening chain.</div>;

  const shock = shocks[channel];
  const scenario = report.scenarios.find((item) => item.channel === channel) ?? null;
  const all = scenario?.impacts ?? [];
  const rows = all.filter((impact) => status === "all" || impact.status === status);
  const count = (wanted: string) => all.filter((impact) => impact.status === wanted).length;
  const calibration = bundle.calibration?.calibrations.find((item) => item.seriesId === SERIES[channel] && item.status === "ready") ?? null;
  const setShock = (value: number) => setCustom((current) => ({ ...current, [channel]: Math.max(LIMITS[channel].min, Math.min(LIMITS[channel].max, Number.isFinite(value) ? value : 0)) }));
  const presets = [
    ...ROUND[channel].map((value) => ({ value, label: shockText(channel, value), title: "A round move" })),
    ...(calibration?.presets ? [
      { value: calibration.presets.mild.shock, label: `Typical day ${shockText(channel, calibration.presets.mild.shock)}`, title: "The median one-day change of the series" },
      { value: calibration.presets.severe.shock, label: `1 day in 10 ${shockText(channel, calibration.presets.severe.shock)}`, title: "A one-day change exceeded on one day in ten" },
      { value: calibration.presets.extreme.shock, label: `1 day in 100 ${shockText(channel, calibration.presets.extreme.shock)}`, title: "A one-day change exceeded on one day in a hundred" },
    ] : []),
  ];
  const opened = open ? all.find((impact) => impact.ticker === open) ?? null : null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `macro-scenario-${channel}-${shockText(channel, shock).replace(/[ %]/g, "").replace("−", "minus").replace("+", "plus")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card className="desk-span-12" title="The shock" subtitle="An assumption you choose, not a forecast of the series">
        <div className="desk-controls" style={{ marginBottom: 12 }}>
          <Segmented<ScenarioChannel> label="What moves" options={CHANNELS.map((item) => ({ value: item, label: `${CHANNEL_LABEL[item]} ${shockText(item, shocks[item])}` }))} value={channel} onChange={(next) => { setChannel(next); setOpen(null); }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            Size, in {inPoints(channel) ? "basis points" : "percent"}
            <input className="desk-input" type="number" aria-label={`Size of the move in ${inPoints(channel) ? "basis points" : "percent"}`} style={{ width: 96 }} step={inPoints(channel) ? 5 : 1}
              min={LIMITS[channel].min * perUnit(channel)} max={LIMITS[channel].max * perUnit(channel)} value={Math.round(shock * perUnit(channel) * 10) / 10}
              onChange={(event) => setShock(Number(event.target.value) / perUnit(channel))} />
          </label>
          <button type="button" className="desk-button" style={{ marginLeft: "auto" }} onClick={download}><Download size={15} aria-hidden="true" /> Export JSON</button>
        </div>
        <div className="desk-scenario-presets" role="group" aria-label="Preset sizes">
          {presets.map((preset) => (
            <button key={preset.label} type="button" className="desk-button" title={preset.title} aria-pressed={Math.abs(preset.value - shock) < 1e-9} onClick={() => setShock(preset.value)}>{preset.label}</button>
          ))}
        </div>
        <p className="desk-muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          {calibration?.presets ? `The day sizes are taken from the series' own daily changes (as of ${fmtDate(bundle.calibration!.asOf.slice(0, 10), "medium")}).` : "No calibration of this series is built, so only round sizes are offered."}
          {scenario?.baseline ? ` ${SERIES_LABEL[scenario.baseline.seriesId] ?? scenario.baseline.seriesId}: ${fmtNum(scenario.baseline.value, 2)} on ${fmtDate(scenario.baseline.observationPeriod, "medium")}, ${fmtNum(scenario.baseline.scenarioValue, 2)} after the move.` : " No baseline value of this series is available."}
        </p>
      </Card>

      <div className="desk-span-12 desk-kpis four" style={{ marginBottom: 0 }}>
        <Kpi label="Computed from current filings" value={`${count("computable")} of ${all.length}`} note={`${CHANNEL_LABEL[channel]} ${shockText(channel, shock)}`} />
        <Kpi label="Old evidence only" value={String(count("historical_only"))} note="the filing behind the figure is older than a year and a half" />
        <Kpi label="No figure" value={String(count("not_computable") + count("not_applicable"))} note={`${count("not_applicable")} where the channel does not apply (interest is the business)`} />
        <Kpi label="With a past share reaction" value={String(all.filter((impact) => impact.measuredResponse?.status === "available").length)} note="companies with past moves to compare with" />
      </div>

      <Card className="desk-span-12" flush title="By company" subtitle="What the company's own filings give for this move: an upper bound or a gross exposure, never a profit forecast. Select a row for the evidence."
        action={(
          <select className="desk-select" aria-label="Evidence status" value={status} onChange={(event) => setStatus(event.target.value as "all" | ScenarioStatus)}>
            <option value="all">All {all.length} companies</option>
            <option value="computable">Computed</option>
            <option value="historical_only">Old evidence only</option>
            <option value="not_applicable">Not applicable</option>
            <option value="not_computable">No figure</option>
          </select>
        )}>
        {rows.length ? (
          <div className="desk-table-wrap scroll" style={{ maxHeight: 640 }}>
            <table className="desk-table" style={{ fontSize: 12.5 }} data-scenario-impacts>
              <thead>
                <tr><th>Company</th><th>Status</th><th>What is measured</th><th className="num">Effect of the move</th><th className="num">Share</th><th>Figures to</th><th className="num" title="The share's median reaction to past moves of this series, per unit of the move, scaled in a straight line to the chosen size">Past share reaction, scaled</th></tr>
              </thead>
              <tbody>
                {rows.map((impact) => {
                  const amount = impact.metrics.find((metric) => metric.unit !== "ratio") ?? null;
                  const share = impact.metrics.find((metric) => metric.unit === "ratio") ?? null;
                  const first = amount ?? share;
                  const measured = impact.measuredResponse?.status === "available" ? impact.measuredResponse : null;
                  const listed = findCompany(snapshot.data, impact.ticker);
                  return (
                    <tr key={impact.ticker} onClick={() => setOpen(impact.ticker)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setOpen(impact.ticker); }}>
                      <td onClick={(event) => event.stopPropagation()}>{listed ? <CompanyLink company={listed} className="desk-ticker">{impact.ticker}</CompanyLink> : <span className="desk-ticker">{impact.ticker}</span>}</td>
                      <td className={impact.status === "computable" ? undefined : "desk-muted"}>{STATUS_LABEL[impact.status] ?? impact.status}</td>
                      <td className="desk-ink-2" style={{ whiteSpace: "normal", maxWidth: 320 }}>{first ? METRIC_LABEL[first.name] ?? sentence(first.name) : impact.reasons[0] ? sentence(impact.reasons[0]) : "—"}</td>
                      <td className="num">{amount ? metricValue(amount) : "—"}</td>
                      <td className="num desk-ink-2" title={share && share.name.includes("upper_bound") ? "As a share of operating income" : share ? "As a share of revenue" : undefined}>{share ? metricValue(share) : "—"}</td>
                      <td className="desk-ink-2">{first?.periodEnd ? fmtDate(first.periodEnd, "medium") : "—"}{first?.stale ? " · old" : ""}</td>
                      <td className="num" title={measured ? `Median of ${measured.count} past observations, per unit of the move, times this move. Past moves were far smaller than a round shock, so this is a straight-line scaling: a description, not a forecast.` : undefined}>{measured ? fmtPct((measured.median ?? 0) * shock, 2) : <span className="desk-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desk-empty" style={{ padding: 24 }}>No company has this status for the chosen move.</div>
        )}
      </Card>
      <p className="desk-span-12 desk-muted" style={{ fontSize: 12.5, margin: 0 }}>
        The {bundle.pilot.companies.length} research companies, from the debt maturities, cash, fuel costs and foreign revenue tagged in their own filings and the series' latest value known on {fmtDate(report.asOf.slice(0, 10), "medium")}.
        A negative interest figure is a gain: the cash earns more than the maturing debt costs. Hedges, fixed-rate shares and pass-through are unknown, which is why these are bounds and gross exposures.
        The past share reaction is the median over past moves of the series, which were far smaller than a round shock; scaled to the chosen size it describes, it does not forecast.
      </p>
      {opened && <Evidence impact={opened} channel={channel} shock={shock} onClose={() => setOpen(null)} />}
    </>
  );
}
