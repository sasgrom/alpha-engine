import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CompanyLink, Kpi, Segmented, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { findCompany, useDeskSnapshot, useReport } from "../../data";
import { DevNotes } from "../../DevNotes";
import { fmtCap, fmtDate, fmtNum, fmtPct } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";
import MarketExpectationsCard from "../../components/MarketExpectationsCard";

interface Evidence {
  value: number | null;
  periodEnd: string | null;
  quality: string;
  stale: boolean;
}

interface ExposureCompany {
  cik: number;
  ticker: string;
  name: string;
  sector: string | null;
  debt: Evidence;
  debtToOperatingIncome: Evidence;
  cashToDebt: Evidence;
}

interface ExposureReport {
  generatedAt: string;
  coverage: Record<string, number>;
  companies: ExposureCompany[];
}

interface ScenarioReport {
  generatedAt: string;
  scenarios: {
    channel: string;
    shock: number;
    baseline: { seriesId: string; value: number; scenarioValue: number; unit: string; observationPeriod: string };
    impacts: { ticker: string; status: string; metrics: { name: string; value: number; unit: string; impactType: string }[] }[];
  }[];
}

const MACRO_LABELS: Record<string, string> = {
  DGS10: "10-year Treasury",
  DGS2: "2-year Treasury",
  T10Y2Y: "10y − 2y spread",
  FEDFUNDS: "Fed funds rate",
  CPIAUCSL: "CPI (index level)",
  UNRATE: "Unemployment rate",
  BAMLH0A0HYM2: "High-yield spread",
  VIXCLS: "VIX",
};

const CHANNEL_LABEL: Record<string, string> = { rates: "Rates", oil: "Oil", usd: "Dollar", credit: "Credit spreads" };
type Shock = "0.005" | "0.01" | "0.02";
type View = "backdrop" | "scenarios";
// the scenario engine and its evidence files are loaded only when the view is opened
const MacroScenarios = lazy(() => import("./MacroScenarios"));

export default function Macro() {
  useDocumentTitle("Macro");
  const snapshot = useDeskSnapshot();
  const macro = trpc.dashboard.macro.useQuery(undefined, { staleTime: 10 * 60_000 });
  const exposures = useReport<ExposureReport>("company-exposures.json");
  const scenarios = useReport<ScenarioReport>("macro-scenarios.json");
  const [shock, setShock] = useState<Shock>("0.01");
  const size = Number(shock);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "scenarios" ? "scenarios" : "backdrop";
  const setView = (next: View) => {
    const updated = new URLSearchParams(params);
    if (next === "backdrop") updated.delete("view");
    else updated.set("view", next);
    setParams(updated, { replace: true });
  };

  const rows = useMemo(
    () =>
      (exposures.data?.companies ?? [])
        .filter((company) => company.debt.value !== null && company.debt.value > 0)
        .map((company) => ({
          company,
          cost: company.debt.value! * size,
          share: company.debtToOperatingIncome.value !== null ? company.debtToOperatingIncome.value * size : null,
        }))
        .sort((a, b) => (b.share ?? -1) - (a.share ?? -1)),
    [exposures.data, size],
  );

  const channels = (scenarios.data?.scenarios ?? []).map((scenario) => ({
    channel: scenario.channel,
    baseline: scenario.baseline,
    computable: scenario.impacts.filter((impact) => impact.status === "computable").length,
    historical: scenario.impacts.filter((impact) => impact.status === "historical_only").length,
    total: scenario.impacts.length,
  }));

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · rates, credit, oil and the dollar against company balance sheets</span>
          <h1>Macro</h1>
          <p className="desk-lede">The latest macro readings, and what a move in rates, oil, the dollar or credit spreads would cost each company at most, taken from its own filings.</p>
        </div>
        <Segmented<View> label="Macro view" options={[{ value: "backdrop", label: "Backdrop and rates" }, { value: "scenarios", label: "Scenarios" }]} value={view} onChange={setView} />
      </div>

      <EvidenceNote family="macro" />

      {view === "scenarios" ? (
        <div className="desk-grid">
          <Suspense fallback={<Shimmer height={420} />}><MacroScenarios /></Suspense>
        </div>
      ) : (
      <div className="desk-grid">
        <MarketExpectationsCard />
        <Card className="desk-span-4" title="Backdrop" subtitle="Latest published values (FRED)">
          {macro.isLoading ? (
            <Shimmer height={220} />
          ) : macro.data?.length ? (
            <div>
              {macro.data.map((point) => (
                <div key={point.seriesId} className="desk-list-row">
                  <span className="desk-list-main"><span>{MACRO_LABELS[point.seriesId] ?? point.label}</span></span>
                  <span className="desk-list-side">
                    <strong className="desk-num" style={{ fontWeight: 560 }}>{point.value === null ? "—" : point.unit === "pct" ? `${fmtNum(point.value, 2)}%` : fmtNum(point.value, point.unit === "index" ? 1 : 2)}</strong>
                    <span className="desk-muted" style={{ fontSize: 12, minWidth: 54, textAlign: "right" }}>{fmtDate(point.date, "short")}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="desk-empty">No macro readings are stored yet.</div>
          )}
        </Card>

        <Card className="desk-span-8" title="What can be computed today" subtitle="Per shock channel: companies whose filings give enough to put a number on it">
          {scenarios.isLoading ? (
            <Shimmer height={220} />
          ) : channels.length ? (
            <div className="desk-kpis four" style={{ marginBottom: 0 }}>
              {channels.map((channel) => (
                <Kpi
                  key={channel.channel}
                  label={CHANNEL_LABEL[channel.channel] ?? channel.channel}
                  value={`${channel.computable} of ${channel.total}`}
                  note={`${channel.historical} with old evidence only · baseline ${channel.baseline.seriesId} ${fmtNum(channel.baseline.value, 2)} on ${fmtDate(channel.baseline.observationPeriod, "short")}`}
                />
              ))}
            </div>
          ) : (
            <div className="desk-empty">The scenario report has not been built.</div>
          )}
          <p className="desk-muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
            Oil exposure is tagged by few companies, so rates, credit and the dollar cover most of the list. Every company's figure with its evidence, for a move of your own size, is under <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => setView("scenarios")}>Scenarios</button>.
          </p>
        </Card>

        <Card
          className="desk-span-12"
          flush
          title="Rate sensitivity of the balance sheet"
          subtitle="Upper bound: all debt reprices at once, no hedges, no fixed-rate share — a ranking of who carries the most debt against what the business earns, not a forecast of interest expense"
          action={<Segmented label="Rate move" options={[{ value: "0.005", label: "+0.5 pt" }, { value: "0.01", label: "+1 pt" }, { value: "0.02", label: "+2 pt" }]} value={shock} onChange={setShock} />}
        >
          {exposures.isLoading ? (
            <Shimmer height={320} />
          ) : exposures.error ? (
            <div className="desk-empty" style={{ padding: 20 }}>{(exposures.error as Error).message}</div>
          ) : rows.length ? (
            <div className="desk-table-wrap scroll">
              <table className="desk-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Sector</th>
                    <th className="num">Debt</th>
                    <th className="num">Debt ÷ operating income</th>
                    <th className="num">Cash ÷ debt</th>
                    <th className="num">Cost of the move, a year</th>
                    <th className="num">Share of operating income</th>
                    <th>Figures as of</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ company, cost, share }) => {
                    const listed = findCompany(snapshot.data, company.ticker);
                    return (
                      <tr key={company.cik} style={{ cursor: "default" }}>
                        <td>
                          {listed ? (
                            <CompanyLink company={listed} className="company-cell"><span className="desk-ticker">{company.ticker}</span><span>{listed.name}</span></CompanyLink>
                          ) : (
                            <span className="company-cell"><span className="desk-ticker">{company.ticker}</span><span>{company.name}</span></span>
                          )}
                        </td>
                        <td className="desk-ink-2">{company.sector ?? listed?.sector ?? "—"}</td>
                        <td className="num">{fmtCap(company.debt.value)}</td>
                        <td className="num">{company.debtToOperatingIncome.value === null ? "—" : `${fmtNum(company.debtToOperatingIncome.value, 2)}×`}</td>
                        <td className="num">{company.cashToDebt?.value === null || company.cashToDebt?.value === undefined ? "—" : `${fmtNum(company.cashToDebt.value, 2)}×`}</td>
                        <td className="num">{fmtCap(cost)}</td>
                        <td className="num" style={{ fontWeight: 560 }}>{share === null ? "—" : fmtPct(share, 1, false)}</td>
                        <td className="desk-ink-2">{fmtDate(company.debt.periodEnd, "short")}{company.debt.stale ? " · old" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>The exposure report has no company with debt evidence.</div>
          )}
        </Card>
      </div>
      )}
      <DevNotes page="macro" />
    </ResearchFrame>
  );
}
