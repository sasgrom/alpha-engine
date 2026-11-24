import { useMemo, useState } from "react";
import type { DeskGuidanceChange, DeskGuidanceRecord } from "@contracts/desk-company";
import { trpc } from "@/providers/trpc";
import { Card, CompanyLink, Delta, Kpi, Segmented, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { findCompany, useDeskSnapshot } from "../../data";
import { DevNotes } from "../../DevNotes";
import { fmtDate, fmtPct } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";
import { guidancePeriodLabel, guidedText } from "../company/Guidance";

type Days = "30" | "90" | "365";
type What = "revised" | "first" | "all";
type Metric = "both" | "revenue" | "eps";
type Order = "above" | "below" | "periods";

/**
 * A revision of more than a quarter of the figure is more often a misread figure or another measure than a real
 * revision (a segment's revenue for the company's, a quarter's earnings for the year's); a few are real (an
 * acquisition, a charge). Such rows are marked and left out of the counts; the release's words show which it is.
 */
const LARGE = 0.25;
const isLarge = (row: DeskGuidanceChange) => row.change !== null && Math.abs(row.change) > LARGE;
const SHOWN = 40;
const BASIS: Record<DeskGuidanceChange["basis"], string> = { gaap: "GAAP", non_gaap: "adjusted", unclear: "" };
const measure = (row: Pick<DeskGuidanceChange, "metric" | "basis">) => (row.metric === "revenue" ? "Revenue" : `EPS${BASIS[row.basis] ? `, ${BASIS[row.basis]}` : ""}`);
const WHAT: Record<DeskGuidanceChange["what"], string> = { first: "First figures", raised: "Raised", cut: "Cut", range: "Range moved" };

export default function Guidance() {
  useDocumentTitle("Guidance");
  const snapshot = useDeskSnapshot();
  const query = trpc.desk.guidanceMarket.useQuery(undefined, { staleTime: 30 * 60_000, refetchOnWindowFocus: false });
  const data = query.data ?? null;
  const [days, setDays] = useState<Days>("90");
  const [what, setWhat] = useState<What>("revised");
  const [metric, setMetric] = useState<Metric>("both");
  const [find, setFind] = useState("");
  const [all, setAll] = useState(false);
  const [recordMetric, setRecordMetric] = useState<"revenue" | "eps">("revenue");
  const [order, setOrder] = useState<Order>("above");
  const [allRecords, setAllRecords] = useState(false);

  const since = useMemo(() => (data ? new Date(Date.parse(data.asOf) - Number(days) * 86_400_000).toISOString().slice(0, 10) : ""), [data, days]);
  const inWindow = useMemo(() => (data?.changes ?? []).filter((row) => row.issued > since), [data, since]);
  const counts = useMemo(() => ({
    raised: inWindow.filter((row) => row.what === "raised" && !isLarge(row)).length,
    cut: inWindow.filter((row) => row.what === "cut" && !isLarge(row)).length,
    first: inWindow.filter((row) => row.what === "first").length,
    large: inWindow.filter(isLarge).length,
    companies: new Set(inWindow.filter((row) => row.what !== "first" && !isLarge(row)).map((row) => row.cik)).size,
  }), [inWindow]);
  const needle = find.trim().toUpperCase();
  const rows = useMemo(() => inWindow.filter((row) =>
    (what === "all" || (what === "first" ? row.what === "first" : row.what !== "first")) &&
    (metric === "both" || row.metric === metric) &&
    (!needle || row.ticker.toUpperCase().includes(needle))), [inWindow, what, metric, needle]);
  const records = useMemo(() => {
    const list = (data?.records ?? []).filter((row) => row.metric === recordMetric);
    const share = (row: DeskGuidanceRecord) => row.above / row.compared;
    return [...list].sort((a, b) => (order === "periods" ? b.compared - a.compared || share(b) - share(a) : order === "above" ? share(b) - share(a) || b.median - a.median : share(a) - share(b) || a.median - b.median) || a.ticker.localeCompare(b.ticker));
  }, [data, recordMetric, order]);

  const companyLink = (ticker: string) => {
    const company = findCompany(snapshot.data, ticker);
    return company ? <CompanyLink company={company} className="desk-ticker">{ticker}</CompanyLink> : <span className="desk-ticker">{ticker}</span>;
  };
  const habit = (key: "revenue" | "eps") => {
    const row = data?.habit[key];
    return row && row.compared ? { value: fmtPct(row.above / row.compared, 0, false), note: `${row.above.toLocaleString("en-US")} of ${row.compared.toLocaleString("en-US")} periods of three years · median ${fmtPct(row.median, 1)} against the midpoint` } : { value: "—", note: "" };
  };

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · what companies said they would report</span>
          <h1>Guidance</h1>
          <p className="desk-lede">
            The revenue and earnings companies guided to, release after release: who raised and who cut, in the release's own words, and how the reported figure then fell against the guidance.
            {data ? ` Releases to ${fmtDate(data.asOf, "medium")}, ${data.companies} companies with guidance.` : ""}
          </p>
        </div>
      </div>

      <EvidenceNote family="guidance" />

      {query.isLoading ? (
        <Shimmer height={420} />
      ) : query.error ? (
        <div className="desk-card desk-empty">The guidance record could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-card desk-empty">The guidance record is our own reading of the companies' releases. It is open to the owner and to reviewers who accepted the agreement.</div>
      ) : (
        <>
          <div className="desk-kpis four">
            <Kpi label={`Raised, last ${days} days`} value={String(counts.raised)} note={`${counts.companies} companies changed a figure · ${counts.first} first figures for a period`} />
            <Kpi label={`Cut, last ${days} days`} value={String(counts.cut)} note={counts.large ? `${counts.large} larger than ${LARGE * 100}% are marked and not counted` : "none larger than 25%"} />
            <Kpi label="Revenue reported above the midpoint" value={habit("revenue").value} note={habit("revenue").note} />
            <Kpi label="EPS reported above the midpoint" value={habit("eps").value} note={habit("eps").note} />
          </div>

          <div className="desk-grid">
            <Card className="desk-span-12" flush title="Changes of guidance" subtitle={`Releases that gave other figures for a period than stood before, or the first figures for it; newest first · guidance standard ${data.guidanceVersion}`}>
              <div className="desk-controls" style={{ padding: "12px 20px 0" }}>
                <Segmented<Days> label="Period" options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "A year" }]} value={days} onChange={(next) => { setDays(next); setAll(false); }} />
                <Segmented<What> label="Kind of change" options={[{ value: "revised", label: "Raised and cut" }, { value: "first", label: "First figures" }, { value: "all", label: "All" }]} value={what} onChange={(next) => { setWhat(next); setAll(false); }} />
                <Segmented<Metric> label="Measure" options={[{ value: "both", label: "Both" }, { value: "revenue", label: "Revenue" }, { value: "eps", label: "EPS" }]} value={metric} onChange={(next) => { setMetric(next); setAll(false); }} />
                <input className="desk-input" type="search" placeholder="Ticker" aria-label="Filter the changes by ticker" value={find} onChange={(event) => setFind(event.target.value)} style={{ width: 120 }} />
                <span className="desk-muted" style={{ marginLeft: "auto", fontSize: 13 }}>{rows.length} change{rows.length === 1 ? "" : "s"}</span>
              </div>
              {rows.length ? (
                <div className={all && rows.length > SHOWN ? "desk-table-wrap scroll" : "desk-table-wrap"} style={all && rows.length > SHOWN ? { maxHeight: 640 } : undefined}>
                  <table className="desk-table" style={{ fontSize: 12.5 }} data-guidance-changes>
                    <thead>
                      <tr><th>Released</th><th>Company</th><th>Measure</th><th>Period</th><th>Change</th><th className="num">Before</th><th className="num">Now</th><th className="num">By</th><th>In the release's words</th></tr>
                    </thead>
                    <tbody>
                      {(all ? rows : rows.slice(0, SHOWN)).map((row) => (
                        <tr key={`${row.cik}|${row.issued}|${row.metric}|${row.basis}|${row.kind}|${row.periodEnd}`} style={{ cursor: "default" }}>
                          <td>{fmtDate(row.issued, "medium")}</td>
                          <td>{companyLink(row.ticker)}</td>
                          <td className="desk-ink-2">{measure(row)}</td>
                          <td className="desk-ink-2" title={`Period to ${fmtDate(row.periodEnd, "medium")}`}>{guidancePeriodLabel(row)}</td>
                          <td>
                            {WHAT[row.what]}
                            {isLarge(row) && <span className="desk-badge" style={{ marginLeft: 6, height: 18 }} title="A change this large is more often a misread figure or another measure than a real revision. Read the release's words.">check</span>}
                          </td>
                          <td className="num desk-ink-2">{row.before ? guidedText(row.before, row.metric) : "—"}</td>
                          <td className="num">{guidedText(row.now, row.metric)}</td>
                          <td className="num">{row.change === null || row.what === "range" ? <span className="desk-muted">—</span> : isLarge(row) ? <span className="desk-muted">{fmtPct(row.change, 0)}</span> : <Delta value={row.change} digits={1} />}</td>
                          <td className="desk-muted" style={{ whiteSpace: "normal", minWidth: 260, maxWidth: 460 }}>{row.quote ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="desk-empty" style={{ padding: 24 }}>No change of guidance matches.</div>
              )}
              {rows.length > SHOWN && (
                <div style={{ padding: "10px 20px 14px" }}>
                  <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAll((open) => !open)}>
                    {all ? `Show the latest ${SHOWN}` : `Show all ${rows.length}`}
                  </button>
                </div>
              )}
            </Card>

            <Card className="desk-span-12" flush title="Record against their own guidance" subtitle="Each company's reported figures against its last guided midpoint; companies with at least four periods to compare">
              <div className="desk-controls" style={{ padding: "12px 20px 0" }}>
                <Segmented<"revenue" | "eps"> label="Measure of the record" options={[{ value: "revenue", label: "Revenue" }, { value: "eps", label: "EPS" }]} value={recordMetric} onChange={(next) => { setRecordMetric(next); setAllRecords(false); }} />
                <Segmented<Order> label="Order" options={[{ value: "above", label: "Most often above" }, { value: "below", label: "Least often above" }, { value: "periods", label: "Most periods" }]} value={order} onChange={setOrder} />
                <span className="desk-muted" style={{ marginLeft: "auto", fontSize: 13 }}>{records.length} companies</span>
              </div>
              {records.length ? (
                <div className={allRecords ? "desk-table-wrap scroll" : "desk-table-wrap"} style={allRecords ? { maxHeight: 560 } : undefined}>
                  <table className="desk-table" style={{ fontSize: 12.5 }} data-guidance-records>
                    <thead>
                      <tr><th>Company</th><th className="num">Periods compared</th><th className="num">Above the midpoint</th><th className="num">Share</th><th className="num">Median difference</th></tr>
                    </thead>
                    <tbody>
                      {(allRecords ? records : records.slice(0, 15)).map((row) => (
                        <tr key={row.cik} style={{ cursor: "default" }}>
                          <td>{companyLink(row.ticker)}</td>
                          <td className="num">{row.compared}</td>
                          <td className="num">{row.above}</td>
                          <td className="num">{fmtPct(row.above / row.compared, 0, false)}</td>
                          <td className="num"><Delta value={row.median} digits={1} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="desk-empty" style={{ padding: 24 }}>No company has four periods to compare for this measure.</div>
              )}
              {records.length > 15 && (
                <div style={{ padding: "10px 20px 14px" }}>
                  <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAllRecords((open) => !open)}>
                    {allRecords ? "Show the first 15" : `Show all ${records.length}`}
                  </button>
                </div>
              )}
            </Card>
          </div>
          <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Read from the companies' earnings releases (guidance standard {data.guidanceVersion}); revenue and earnings per share only, for quarters and fiscal years. The reported figure is the one first filed (standard
            fundamentals {data.standard}), or for adjusted earnings per share the figure the release itself printed; where neither can be verified the period is not compared. Each company's full history is on its page.
          </p>
        </>
      )}
      <DevNotes page="guidance" />
    </ResearchFrame>
  );
}
