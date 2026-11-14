import type { PredictionExpectationsReport, PredictionValues } from "@contracts/prediction-markets";
import { Card, Kpi, Shimmer } from "../components";
import { useReport } from "../data";
import { fmtDate, fmtNum, fmtPct } from "../format";

function asOf(value: string | null): string {
  if (!value) return "unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unavailable";
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date)} UTC`;
}

function probability(value: number | null): string {
  return value === null ? "—" : fmtPct(value, 1, false);
}

function FeedValues({ values }: { values: PredictionValues }) {
  return (
    <>
      <span className="desk-num">{probability(values.primary)}</span>
      <span className="desk-num">{probability(values.alternate)}</span>
    </>
  );
}

export function PredictionExpectationsCard({ report, loading = false, error = null, now = new Date() }: { report: PredictionExpectationsReport | null; loading?: boolean; error?: string | null; now?: Date }) {
  const stale = report?.asOf ? now.getTime() - new Date(report.asOf).getTime() > 36 * 3_600_000 : false;
  return (
    <Card className="desk-span-12" title="What the market expects" subtitle="Public probability markets as context and scenario priors, not a standalone trading signal">
      {loading ? <Shimmer height={220} /> : error ? <div className="desk-empty">{error}</div> : !report || report.status === "empty" ? (
        <div className="desk-empty">No market expectations have been collected yet.</div>
      ) : (
        <>
          <div className="desk-kpis three">
            <Kpi
              label="Next listed Fed decision"
              value={report.fed.meeting ? fmtDate(report.fed.meeting, "short") : "—"}
              note={report.fed.expectedUpper.primary === null ? "No complete rate distribution" : `${fmtNum(report.fed.expectedUpper.primary, 2)}% expected upper bound`}
            />
            <Kpi
              label="Next CPI expectation"
              value={report.cpi.expected.primary === null ? "—" : `${fmtNum(report.cpi.expected.primary, 2)}%`}
              note={report.cpi.spread.primary === null ? "Spread unavailable" : `±${fmtNum(report.cpi.spread.primary, 2)} points · month on month`}
            />
            <Kpi label="Recession probability" value={probability(report.recession.probability.primary)} note={`${probability(report.recession.probability.alternate)} on the alternate feed`} />
          </div>
          <div className="desk-list-row desk-muted" style={{ fontSize: 12 }}>
            <span>Next Fed decision</span>
            <span className="desk-num">Primary feed</span>
            <span className="desk-num">Alternate feed</span>
          </div>
          {(["cut", "unchanged", "hike"] as const).map(outcome => (
            <div className="desk-list-row" key={outcome}>
              <span className="desk-list-main">{outcome === "cut" ? "Rate cut" : outcome === "unchanged" ? "No change" : "Rate hike"}</span>
              <FeedValues values={report.fed.outcomes[outcome]} />
            </div>
          ))}
          <p className="desk-muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
            {report.calibration.fed}. {report.calibration.cpi}. Values are probabilities, not certainty. Company KPI markets are forward evidence, not a validated standalone alpha signal.
          </p>
          <p className="desk-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            As of {asOf(report.asOf)}{stale ? " · stale snapshot" : ""}{report.closed ? " · closed markets; last quotes, not current" : ""}{report.status === "partial" ? " · partial capture" : ""}
          </p>
        </>
      )}
    </Card>
  );
}

export default function MarketExpectationsCard() {
  const report = useReport<PredictionExpectationsReport>("prediction-markets.json", true, { noStore: true });
  return <PredictionExpectationsCard report={report.data ?? null} loading={report.isLoading} error={report.error instanceof Error ? report.error.message : null} />;
}
