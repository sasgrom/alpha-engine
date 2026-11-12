import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { Card, CompanyLink, Delta, Kpi, Notice, Segmented, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { impliedMoveFor, periodBreadth, useDeskSnapshot } from "../../data";
import { DevNotes } from "../../DevNotes";
import { daysBetween, fmtCap, fmtDate, fmtPct, localToday, relativeDay } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";

type Span = "7" | "14" | "30";
type SortKey = "date" | "reaction" | "drift" | "cap";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** "continued" when the move after the reaction window has the reaction's sign, "reversed" when the opposite. */
function follow(company: DeskCompany): string {
  const reaction = company.lastEarningsReaction;
  const drift = company.lastEarningsDrift;
  if (reaction === null || drift === null || drift === undefined || Math.abs(drift) < 0.005 || Math.abs(reaction) < 0.005) return "—";
  return Math.sign(reaction) === Math.sign(drift) ? "continued" : "reversed";
}

export default function Earnings() {
  useDocumentTitle("Earnings");
  const snapshot = useDeskSnapshot();
  const [span, setSpan] = useState<Span>("14");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState<SortKey>("date");
  const data = snapshot.data;
  const today = localToday();

  const reported = useMemo(() => {
    if (!data) return [];
    const rows = data.companies.filter(
      (company) => company.lastEarnings && daysBetween(company.lastEarnings, data.session) >= 0 && daysBetween(company.lastEarnings, data.session) <= Number(span) && (sector === "all" || company.sector === sector),
    );
    const value = (company: DeskCompany) => (sort === "reaction" ? company.lastEarningsReaction : sort === "drift" ? company.lastEarningsDrift ?? null : sort === "cap" ? company.marketCap : null);
    return rows.sort((a, b) => (sort === "date" ? b.lastEarnings!.localeCompare(a.lastEarnings!) || (b.marketCap ?? 0) - (a.marketCap ?? 0) : (value(b) ?? -Infinity) - (value(a) ?? -Infinity)));
  }, [data, span, sector, sort]);

  const upcoming = useMemo(() => {
    if (!data) return [];
    return data.companies
      .filter((company) => company.nextEarnings && company.nextEarnings >= today && daysBetween(data.session, company.nextEarnings) <= 30 && (sector === "all" || company.sector === sector))
      .sort((a, b) => a.nextEarnings!.localeCompare(b.nextEarnings!) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  }, [data, sector, today]);

  if (snapshot.isLoading) return <ResearchFrame><Shimmer height={520} /></ResearchFrame>;
  if (snapshot.error) return <ResearchFrame><Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice></ResearchFrame>;
  if (!data) return <ResearchFrame><Notice title="Earnings are not ready yet">The market snapshot has not been built.</Notice></ResearchFrame>;

  const reactions = reported.map((company) => company.lastEarningsReaction).filter((value): value is number => value !== null);
  const up = reported.filter((company) => (company.lastEarningsReaction ?? 0) > 0);
  const down = reported.filter((company) => (company.lastEarningsReaction ?? 0) < 0);
  const drifts = (rows: DeskCompany[]) => rows.map((company) => company.lastEarningsDrift).filter((value): value is number => value !== null && value !== undefined);
  const market = periodBreadth(data.companies, "w1");

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · reports, first reactions and what followed</span>
          <h1>Earnings</h1>
          <p className="desk-lede">Who reported, how the stock reacted over the two sessions around the report, and how it has moved since. Upcoming dates are projected from each company's own calendar.</p>
        </div>
      </div>

      <EvidenceNote family="reaction">
        <p className="desk-muted" style={{ margin: 0, fontSize: 12.5 }}>
          The figures below describe the current season. They are not a test: one season is a few hundred reports that share one market.
        </p>
      </EvidenceNote>

      <div className="desk-controls">
        <Segmented label="Reported within" options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }]} value={span} onChange={setSpan} />
        <select className="desk-select" aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="all">All sectors</option>
          {data.sectors.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
        <Segmented label="Sort reported by" options={[{ value: "date", label: "Newest" }, { value: "reaction", label: "Reaction" }, { value: "drift", label: "Since then" }, { value: "cap", label: "Size" }]} value={sort} onChange={setSort} />
      </div>

      <div className="desk-kpis">
        <Kpi label={`Reported in ${span} days`} value={String(reported.length)} note={sector === "all" ? "index companies" : sector} />
        <Kpi label="Rose on the report" value={reactions.length ? fmtPct(up.length / reactions.length, 0, false) : "—"} note={`${up.length} up · ${down.length} down`} />
        <Kpi label="Median reaction" value={<Delta value={median(reactions)} digits={1} />} note="close before the report to the session after" />
        <Kpi label="Since then, after a rise" value={<Delta value={median(drifts(up))} digits={1} />} note={`median of ${drifts(up).length} companies`} />
        <Kpi label="Since then, after a fall" value={<Delta value={median(drifts(down))} digits={1} />} note={`median of ${drifts(down).length} · index median 1W ${fmtPct(market.median, 1)}`} />
      </div>

      <div className="desk-grid">
        <Card className="desk-span-7" flush title="Reported" subtitle="Reaction: two sessions around the report · Since then: from the end of that window to the latest close">
          <div className="desk-table-wrap scroll" style={{ maxHeight: 620 }}>
            <table className="desk-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Report</th>
                  <th className="num">Reaction</th>
                  <th className="num">Since then</th>
                  <th>Followed</th>
                  <th className="num">Market value</th>
                </tr>
              </thead>
              <tbody>
                {reported.map((company) => (
                  <tr key={company.cik} style={{ cursor: "default" }}>
                    <td>
                      <CompanyLink company={company} className="company-cell">
                        <span className="desk-ticker">{company.ticker}</span>
                        <span>{company.name}</span>
                      </CompanyLink>
                    </td>
                    <td className="desk-ink-2">{fmtDate(company.lastEarnings, "short")}</td>
                    <td className="num"><Delta value={company.lastEarningsReaction} digits={1} /></td>
                    <td className="num">
                      <Delta value={company.lastEarningsDrift ?? null} digits={1} />
                      {company.lastEarningsDriftSessions ? <span className="desk-muted" style={{ fontSize: 11.5 }}> · {company.lastEarningsDriftSessions}d</span> : null}
                    </td>
                    <td className="desk-ink-2">{follow(company)}</td>
                    <td className="num desk-ink-2">{fmtCap(company.marketCap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!reported.length && <div className="desk-empty" style={{ padding: 20 }}>No reports in this window.</div>}
        </Card>

        <Card className="desk-span-5" flush title="Coming up · 30 days" subtitle="Projected dates · implied move where option data exists">
          <div className="desk-table-wrap scroll" style={{ maxHeight: 620 }}>
            <table className="desk-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Projected</th>
                  <th className="num">Implied</th>
                  <th className="num">Last reaction</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((company) => {
                  const implied = impliedMoveFor(company, Math.max(1, daysBetween(data.session, company.nextEarnings!)));
                  return (
                    <tr key={company.cik} style={{ cursor: "default" }}>
                      <td>
                        <CompanyLink company={company} className="company-cell" style={{ minWidth: 120 }}>
                          <span className="desk-ticker">{company.ticker}</span>
                          <span>{company.name}</span>
                        </CompanyLink>
                      </td>
                      <td>
                        {fmtDate(company.nextEarnings, "weekday")}
                        <span className="desk-muted" style={{ display: "block", fontSize: 11.5 }}>{relativeDay(company.nextEarnings!, today)} · {company.nextEarningsBasis === "history" ? "from last year" : "13-week step"}</span>
                      </td>
                      <td className="num">{implied ? `±${fmtPct(implied.pct, 1, false)}` : <span className="desk-muted">—</span>}</td>
                      <td className="num"><Delta value={company.lastEarningsReaction} digits={1} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!upcoming.length && <div className="desk-empty" style={{ padding: 20 }}>No projected reports in the next 30 days.</div>}
        </Card>
      </div>

      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
        What management guided to, and how it changed, is in <Link className="desk-link" to="/expectations">Expectations</Link> (classic view) until a per-company summary is built for the desk.
      </p>
      <DevNotes page="earnings" />
    </ResearchFrame>
  );
}
