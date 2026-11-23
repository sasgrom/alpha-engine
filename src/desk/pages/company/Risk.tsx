import { useMemo } from "react";
import { DrawdownChart } from "../../charts/DrawdownChart";
import { PeriodBars } from "../../charts/PeriodBars";
import { Card, Delta } from "../../components";
import { useDesk } from "../../context";
import { fmtDate, fmtPct } from "../../format";
import { priceRisk, type ClosePoint, type ReturnBin } from "./price-risk";

function Stat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="desk-stat">
      <span>{label}{detail && <span className="desk-muted" style={{ display: "block", fontSize: 11.5 }}>{detail}</span>}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Decimals a bin edge needs: whole percents for bins of 1% or wider, one decimal for half percents, two below (edges are sums of floats). */
const digits = (step: number) => (step > 0.0099 ? 0 : step > 0.0049 ? 1 : 2);
const edge = (value: number, step: number) => fmtPct(value, digits(step), true);

/** "Days that moved −1.0% to −0.5%"; the end bins also hold everything beyond them. */
export function binTitle(bin: ReturnBin): string {
  const step = bin.to - bin.from;
  if (bin.openLow) return `Days that fell more than ${fmtPct(Math.abs(bin.to), digits(step), false)}`;
  if (bin.openHigh) return `Days that rose more than ${fmtPct(bin.from, digits(step), false)}`;
  return `Days that moved ${edge(bin.from, step)} to ${edge(bin.to, step)}`;
}

/**
 * The run of closes shown on the price chart, read for risk: the period's figures, how far the price sat below its
 * high, and how the daily moves were spread. It follows the range chosen on the price chart.
 */
export function CompanyRisk({ points, rangeLabel, intraday }: { points: ClosePoint[]; rangeLabel: string; intraday: boolean }) {
  const { palette } = useDesk();
  const risk = useMemo(() => (intraday ? null : priceRisk(points)), [points, intraday]);
  return (
    <Card
      className="desk-span-12"
      title="Risk and returns"
      subtitle={risk
        ? `Daily closes, adjusted for splits and dividends · ${fmtDate(risk.from, "medium")} to ${fmtDate(risk.to, "medium")} · ${risk.sessions} sessions · follows the range of the price chart (${rangeLabel})`
        : "From the daily closes of the range chosen on the price chart"}
    >
      {intraday ? (
        <div className="desk-empty">Choose a range of one month or longer on the price chart to see the drawdown and the spread of daily returns.</div>
      ) : !risk ? (
        <div className="desk-empty">Not enough stored closes in this range.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "8px 28px", alignItems: "start" }}>
          <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }} data-risk-stats>
            <Stat label="Return over the range" value={<Delta value={risk.totalReturn} digits={1} />} />
            <Stat label="Volatility, annualized" value={fmtPct(risk.annualVolatility, 1, false)} detail="spread of the daily returns × √252" />
            <Stat label="Largest fall from a high" value={fmtPct(risk.maxDrawdown, 1)} detail={risk.maxDrawdown < 0 ? `${fmtDate(risk.peakDate, "medium")} to ${fmtDate(risk.troughDate, "medium")}` : "none in this range"} />
            <Stat label="Now below the range's high" value={risk.currentDrawdown === 0 ? "at the high" : fmtPct(risk.currentDrawdown, 1)} />
            {risk.best && <Stat label="Best day" value={<Delta value={risk.best.value} digits={1} />} detail={fmtDate(risk.best.date, "medium")} />}
            {risk.worst && <Stat label="Worst day" value={<Delta value={risk.worst.value} digits={1} />} detail={fmtDate(risk.worst.date, "medium")} />}
            <Stat label="Days that closed higher" value={fmtPct(risk.upShare, 0, false)} />
          </div>
          <div data-risk-drawdown>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Fall from the high <span className="desk-muted" style={{ fontWeight: 400 }}>· distance below the highest close so far</span></div>
            <DrawdownChart points={risk.drawdown} height={190} palette={palette} />
          </div>
          <div data-risk-histogram>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Daily returns <span className="desk-muted" style={{ fontWeight: 400 }}>· how many days moved how much</span></div>
            <PeriodBars
              bars={risk.bins.map((bin) => ({ key: String(bin.from), label: edge(bin.from, bin.to - bin.from), title: binTitle(bin), value: bin.count || null }))}
              format={(count) => `${count} day${count === 1 ? "" : "s"}`}
              axisFormat={(count) => String(count)}
              yearSteps={0}
              labelAt={(index) => (index - risk.bins.length / 2) % (risk.bins.length > 12 ? 4 : 2) === 0}
              labelAtEdge
              name="Daily returns by size"
              height={190}
              palette={palette}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
