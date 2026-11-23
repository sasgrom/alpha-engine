import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DeskCompanyGuidance, DeskGuidancePeriod, DeskGuidanceUpdate } from "@contracts/desk-company";
import { Card, Delta, Segmented, Shimmer } from "../../components";
import { fmtCompact, fmtDate, fmtNum, fmtPct } from "../../format";

type Metric = "revenue" | "eps";
const METRICS: { value: Metric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "eps", label: "Earnings per share" },
];
const NOTE: Record<NonNullable<DeskGuidancePeriod["note"]>, string> = {
  not_reported_yet: "Not reported yet",
  adjusted_basis: "Guided on an adjusted basis; no adjusted figure could be verified in the release",
  not_in_standard: "No comparable figure in the filed statements",
  other_meaning: "The guided figure is another measure (a segment or another definition)",
};
const BASIS: Record<DeskGuidancePeriod["basis"], string> = { gaap: "GAAP", non_gaap: "adjusted", unclear: "basis not stated" };

const money = (value: number, metric: Metric) => (metric === "eps" ? `$${fmtNum(value, 2)}` : `$${fmtCompact(value)}`);

export function guidancePeriodLabel(period: DeskGuidancePeriod): string {
  if (period.kind === "FY") return period.fy != null ? `FY ${period.fy}` : `Year to ${fmtDate(period.periodEnd, "medium")}`;
  return period.fq != null && period.fy != null ? `Q${period.fq} FY${String(period.fy).slice(-2)}` : `Quarter to ${fmtDate(period.periodEnd, "medium")}`;
}

export function guidedText(update: DeskGuidanceUpdate, metric: Metric): string {
  if (update.low !== null && update.high !== null && update.low !== update.high) return `${money(update.low, metric)} to ${money(update.high, metric)}`;
  if (update.low !== null && update.high === null) return `at least ${money(update.low, metric)}`;
  if (update.high !== null && update.low === null) return `up to ${money(update.high, metric)}`;
  return `about ${money(update.mid, metric)}`;
}

/** Where the reported figure fell against the last guidance before it. */
export function againstGuidance(period: DeskGuidancePeriod): { miss: number; place: "above the range" | "inside the range" | "below the range" | "above" | "below" | "as guided" } | null {
  const last = period.updates.at(-1);
  if (!period.actual || !last) return null;
  const miss = period.actual.value / last.mid - 1;
  if (last.low !== null && last.high !== null && last.low !== last.high) {
    return { miss, place: period.actual.value > last.high ? "above the range" : period.actual.value < last.low ? "below the range" : "inside the range" };
  }
  return { miss, place: Math.abs(miss) < 0.005 ? "as guided" : miss > 0 ? "above" : "below" };
}

/** "Reported above its own midpoint in 14 of 16 periods, by a median 2.1%." Null with fewer than four comparisons. */
export function guidanceHabit(periods: DeskGuidancePeriod[]): string | null {
  const misses = periods.map((period) => againstGuidance(period)?.miss).filter((miss): miss is number => miss !== undefined);
  if (misses.length < 4) return null;
  const sorted = [...misses].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const above = misses.filter((miss) => miss > 0).length;
  return `Reported above its own guided midpoint in ${above} of ${misses.length} periods; the median difference was ${fmtPct(median, 1)}.`;
}

function updatesTitle(period: DeskGuidancePeriod): string {
  const lines = period.updates.map((update) => `${fmtDate(update.issued, "medium")}: ${guidedText(update, period.metric)}`);
  if (period.reaffirmed) lines.push(`Repeated unchanged in ${period.reaffirmed} later release${period.reaffirmed === 1 ? "" : "s"}`);
  return lines.join(" · ");
}

export function GuidanceTable({ data, metric, limit }: { data: DeskCompanyGuidance; metric: Metric; limit: number }) {
  const all = data.periods.filter((period) => period.metric === metric);
  if (!all.length) return <div className="desk-empty">The company gave no {metric === "revenue" ? "revenue" : "per-share earnings"} guidance with a figure in its releases of the last six years.</div>;
  const rows = all.slice(0, limit);
  const habit = guidanceHabit(all);
  return (
    <>
      <div className="desk-table-wrap">
        <table className="desk-table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Guided</th>
              <th scope="col">First given</th>
              <th scope="col" className="num">Reported</th>
              <th scope="col" className="num">Against the midpoint</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((period) => {
              const last = period.updates.at(-1)!;
              const against = againstGuidance(period);
              const changes = period.updates.length - 1;
              return (
                <tr key={`${period.kind}|${period.basis}|${period.periodEnd}`}>
                  <th scope="row" style={{ fontWeight: 500, textAlign: "left" }} title={`Period ending ${fmtDate(period.periodEnd, "medium")}`}>
                    {guidancePeriodLabel(period)}
                    {metric === "eps" && <span className="desk-muted"> · {BASIS[period.basis]}</span>}
                  </th>
                  <td title={updatesTitle(period)}>
                    {guidedText(last, metric)}
                    {changes > 0 && <span className="desk-muted"> · changed {changes === 1 ? "once" : `${changes} times`}</span>}
                  </td>
                  <td>{fmtDate(period.updates[0].issued, "medium")}</td>
                  <td className="num" title={period.actual
                    ? period.actual.how === "release"
                      ? `The adjusted figure as the earnings release printed it, ${fmtDate(period.actual.filed, "medium")}; it is not in the filed statements`
                      : `As first reported, filed ${fmtDate(period.actual.filed, "medium")}${period.actual.how === "four_quarters" ? " · the sum of the year's four quarters" : ""}`
                    : undefined}>
                    {period.actual ? money(period.actual.value, metric) : <span className="desk-muted">{NOTE[period.note ?? "not_in_standard"]}</span>}
                  </td>
                  <td className="num">
                    {against ? (
                      <>
                        <Delta value={against.miss} digits={1} />
                        <span className="desk-muted"> · {against.place}</span>
                      </>
                    ) : (
                      <span className="desk-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {habit && <p className="desk-ink-2" style={{ fontSize: 12.5, margin: "10px 0 0" }}>{habit}</p>}
    </>
  );
}

export function CompanyGuidance({ cik }: { cik: number }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [all, setAll] = useState(false);
  const query = trpc.desk.companyGuidance.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const data = query.data;
  const count = data ? data.periods.filter((period) => period.metric === metric).length : 0;
  return (
    <Card
      className="desk-span-8"
      title="Guidance and what was reported"
      subtitle={data
        ? `What the company said in its earnings releases, and the figure it then filed · guidance standard ${data.guidanceVersion}`
        : "What the company said in its earnings releases, and the figure it then filed"}
      action={data ? <Segmented options={METRICS} value={metric} onChange={(next) => { setMetric(next); setAll(false); }} label="Measure" /> : undefined}
    >
      {query.isLoading ? (
        <Shimmer height={200} />
      ) : query.error ? (
        <div className="desk-empty">The guidance could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-empty">No guidance with a figure was found in this company's earnings releases of the last six years.</div>
      ) : (
        <>
          <GuidanceTable data={data} metric={metric} limit={all ? Infinity : 8} />
          {count > 8 && (
            <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, marginTop: 8, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAll((open) => !open)}>
              {all ? "Show the latest eight" : `Show all ${count} periods`}
            </button>
          )}
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            The statements were read from the releases by a language model and kept only when the quote is in the release and its numbers are in the quote. Hover a guided figure for its changes.
          </p>
        </>
      )}
    </Card>
  );
}
