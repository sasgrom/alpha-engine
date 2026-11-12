import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowUpRight, Download, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { DESK_PERIODS, type DeskCompany } from "@contracts/desk-snapshot";
import { PriceChart, type ImpliedCone } from "../charts/PriceChart";
import { Card, CompanyLink, Delta, Notice, RangeBar, Segmented, Shimmer, TickerMark } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { findCompany, impliedMoveFor, peersOf, periodLabel, searchCompanies, useDeskSnapshot } from "../data";
import { daysBetween, entityName, fmtCap, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, localToday, personName, relativeDay } from "../format";
import { rememberTicker } from "../preferences";

type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";
const RANGES: { value: Range; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "YTD", label: "YTD" },
  { value: "1Y", label: "1Y" },
  { value: "5Y", label: "5Y" },
  { value: "ALL", label: "Max" },
];

const INSIDER_CODES: Record<string, string> = {
  P: "Purchase",
  S: "Sale",
  A: "Grant or award",
  M: "Option exercise",
  X: "Option exercise",
  F: "Tax withholding",
  G: "Gift",
  D: "Returned to issuer",
  C: "Conversion",
  J: "Other",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="desk-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NotFound({ ticker, companies }: { ticker: string; companies: DeskCompany[] }) {
  const { openSearch } = useDesk();
  const suggestions = searchCompanies(companies, ticker, 6);
  return (
    <Notice title={`No company in the index matches “${ticker}”`}>
      <p style={{ margin: "0 0 12px" }}>The desk covers the S&amp;P 500 and the research companies.</p>
      {suggestions.length > 0 && (
        <p style={{ margin: "0 0 12px" }}>
          Did you mean{" "}
          {suggestions.map((company, index) => (
            <span key={company.cik}>
              {index > 0 && ", "}
              <CompanyLink company={company} className="desk-link">{company.ticker}</CompanyLink>
            </span>
          ))}
          ?
        </p>
      )}
      <button type="button" className="desk-button" onClick={openSearch}><Search size={15} aria-hidden="true" /> Search</button>
    </Notice>
  );
}

export default function CompanyPage() {
  const { ticker = "" } = useParams();
  const { palette, isPresentation } = useDesk();
  const snapshot = useDeskSnapshot();
  const company = findCompany(snapshot.data, ticker);
  useDocumentTitle(company ? `${company.ticker} · ${company.name}` : ticker.toUpperCase() || "Company");
  const [range, setRange] = useState<Range>("1Y");
  const cik = company?.cik ?? 0;
  const history = trpc.prices.history.useQuery({ cik, range }, { enabled: cik > 0, staleTime: 5 * 60_000, placeholderData: (previous) => previous });
  const events = trpc.events.byCompany.useQuery({ cik }, { enabled: cik > 0 && !!company?.research, staleTime: 10 * 60_000 });
  const insiders = trpc.company.insiderTrades.useQuery({ cik }, { enabled: cik > 0, staleTime: 10 * 60_000 });
  const shortInterest = trpc.company.shortInterest.useQuery({ cik }, { enabled: cik > 0, staleTime: 10 * 60_000 });
  // the 13F summary is the one slow read: it starts after the price history so it never holds the chart back
  const institutional = trpc.company.institutional.useQuery({ cik }, { enabled: cik > 0 && history.isSuccess, staleTime: 30 * 60_000 });

  useEffect(() => {
    if (company) rememberTicker(company.ticker);
  }, [company]);

  const points = useMemo(() => (history.data?.bars ?? []).filter((bar) => bar.close !== null).map((bar) => ({ date: bar.date, close: bar.close as number })), [history.data]);
  const lastEarnings = company?.lastEarnings ?? null;
  const eventDates = useMemo(() => {
    const dates = new Set<string>((events.data ?? []).map((event) => String(event.eventDate).slice(0, 10)));
    if (lastEarnings) dates.add(lastEarnings);
    return [...dates];
  }, [events.data, lastEarnings]);
  const cone = useMemo<ImpliedCone | null>(() => {
    const buckets = (company?.options?.buckets ?? []).filter((bucket) => bucket.expectedMovePct !== null && bucket.days > 0 && bucket.days <= 60);
    return buckets.length ? { points: buckets.map((bucket) => ({ days: bucket.days, pct: bucket.expectedMovePct! })), label: "Options-implied range" } : null;
  }, [company]);

  if (snapshot.isLoading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Shimmer height={72} width="60%" />
        <Shimmer height={360} />
      </div>
    );
  }
  if (snapshot.error) return <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice>;
  if (!snapshot.data) return <Notice title="Company pages are not ready yet">They are prepared after each market close. Please check back shortly.</Notice>;
  if (!company) return <NotFound ticker={ticker} companies={snapshot.data.companies} />;

  const data = snapshot.data;
  const today = localToday();
  const peers = peersOf(data, company, 6);
  const daysToReport = company.nextEarnings ? daysBetween(data.session, company.nextEarnings) : null;
  const implied = daysToReport !== null ? impliedMoveFor(company, daysToReport) : null;
  const atm30 = company.options?.buckets.find((bucket) => bucket.bucket === "8-30D") ?? null;
  const institutionalData = institutional.data;
  const short = shortInterest.data?.current ?? null;

  const downloadCsv = () => {
    const lines = ["date,close", ...points.map((point) => `${point.date},${point.close}`)];
    const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${company.ticker}-${range}-closes.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="desk-company-head">
        <div className="desk-company-title">
          <TickerMark ticker={company.ticker} size={52} />
          <div>
            <h1>{company.name}</h1>
            <div className="desk-company-meta">
              <span className="desk-ticker" style={{ color: "var(--d-ink)" }}>{company.ticker}</span>
              <span>·</span>
              <span>{company.sector}</span>
              {company.industry && <><span>·</span><span>{company.industry}</span></>}
              {company.research && <span className="desk-badge accent">Research company</span>}
            </div>
          </div>
        </div>
        <div className="desk-price">
          <strong>{fmtPrice(company.close)}</strong>
          <span className="delta"><Delta value={company.returns.d1} digits={2} /> <span className="desk-muted" style={{ fontWeight: 400 }}>on {fmtDate(company.lastDate, "short")}</span></span>
        </div>
      </div>

      <div className="desk-returns" style={{ marginBottom: 16 }}>
        {DESK_PERIODS.map((period) => (
          <div key={period} className="desk-return">
            <span>{periodLabel(period)}</span>
            <strong className={`desk-${company.returns[period] === null ? "flat" : company.returns[period]! >= 0 ? "up" : "down"}`}>{fmtPct(company.returns[period], 1)}</strong>
          </div>
        ))}
      </div>

      <div className="desk-grid">
        <Card
          className="desk-span-8"
          title="Price"
          subtitle={cone && isPresentation ? "Daily closes · the shaded cone is the move options price in over the next weeks" : "Daily closes, adjusted for splits and dividends"}
          action={<Segmented label="Chart range" options={RANGES} value={range} onChange={setRange} />}
        >
          <div className={history.isFetching && history.data ? "desk-refetching" : undefined}>
            {history.isLoading ? <Shimmer height={320} /> : points.length >= 2 ? <PriceChart points={points} events={eventDates} cone={isPresentation ? cone : null} palette={palette} /> : <div className="desk-empty">No stored price history for this range.</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12, flexWrap: "wrap" }}>
            <span className="desk-legend">
              <span><span className="desk-swatch" style={{ background: palette.accent, height: 3, borderRadius: 2 }} />Close</span>
              <span><span className="desk-swatch" style={{ background: palette.ink, borderRadius: 10, width: 8, height: 8 }} />Earnings report</span>
              {cone && isPresentation && <span><span className="desk-swatch" style={{ background: palette.accent, opacity: 0.25 }} />Options-implied range</span>}
            </span>
            <button type="button" className="desk-button" style={{ height: 30 }} onClick={downloadCsv} disabled={!points.length}>
              <Download size={14} aria-hidden="true" /> Closes as CSV
            </button>
          </div>
        </Card>

        <Card className="desk-span-4" title="Key statistics">
          <div style={{ marginBottom: 16 }}>
            <div className="desk-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>52-week closing range</div>
            <RangeBar low={company.low52} high={company.high52} value={company.close} />
          </div>
          <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
            <Stat label="Market value" value={fmtCap(company.marketCap)} />
            <Stat label="P/E ratio" value={fmtNum(company.pe, 1)} />
            <Stat label="Earnings per share (TTM)" value={company.epsTtm === null ? "—" : fmtPrice(company.epsTtm)} />
            <Stat label="Dividend yield" value={company.dividendYield ? fmtPct(company.dividendYield, 2, false) : "—"} />
            <Stat label="Beta" value={fmtNum(company.beta, 2)} />
            <Stat label="Volatility (20 days, annualized)" value={fmtPct(company.vol20, 1, false)} />
            <Stat label="50-day / 200-day average" value={`${fmtPrice(company.ma50)} / ${fmtPrice(company.ma200)}`} />
          </div>
        </Card>

        <Card className="desk-span-4" title="Earnings" subtitle="Report dates and how the stock reacted">
          <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
            <Stat label="Last report" value={company.lastEarnings ? `${fmtDate(company.lastEarnings)} · ${relativeDay(company.lastEarnings, today)}` : "—"} />
            <Stat label={`Reaction (${company.lastEarningsReactionSessions === 1 ? "report day" : "two sessions"})`} value={<Delta value={company.lastEarningsReaction} digits={1} />} />
            <Stat label="Next report (projected)" value={company.nextEarnings ? `~${fmtDate(company.nextEarnings)} · ${relativeDay(company.nextEarnings, today)}` : "—"} />
            {isPresentation && implied && <Stat label={`Options-implied move over ${implied.days} days`} value={`±${fmtPct(implied.pct, 1, false)}`} />}
          </div>
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            {company.nextEarningsBasis === "history" ? "Projected 52 weeks after the same quarter's report last year." : company.nextEarningsBasis === "cadence" ? "Projected 13 weeks after the last report." : "No projection: the next date is not yet clear from the reporting calendar."}
          </p>
        </Card>

        {isPresentation && company.options ? (
          <Card className="desk-span-4" title="Options" subtitle={`Schwab option chains · captured ${fmtDate(company.options.capturedAt.slice(0, 10), "short")}`}>
            <table className="desk-table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ position: "static" }}>Expiry window</th>
                  <th className="num" style={{ position: "static" }}>ATM IV</th>
                  <th className="num" style={{ position: "static" }}>Implied move</th>
                </tr>
              </thead>
              <tbody>
                {company.options.buckets.filter((bucket) => bucket.atmIv !== null).map((bucket) => (
                  <tr key={bucket.bucket} style={{ cursor: "default" }}>
                    <td>{bucket.bucket === "0DTE" ? "Today" : bucket.bucket.replace("D", " days").replace("-", "–")} <span className="desk-muted">({bucket.days}d)</span></td>
                    <td className="num">{fmtPct(bucket.atmIv, 1, false)}</td>
                    <td className="num">{bucket.expectedMovePct === null ? "—" : `±${fmtPct(bucket.expectedMovePct, 1, false)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {atm30 && company.options.rv20 !== null && (
              <p className="desk-ink-2" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
                One-month options imply <strong>{fmtPct(atm30.atmIv, 1, false)}</strong> annualized volatility against <strong>{fmtPct(company.options.rv20, 1, false)}</strong> realized over the last 20 sessions
                {company.options.ivRvSpread !== null && (company.options.ivRvSpread > 0 ? ": options price more movement than the stock has delivered lately." : ": options price less movement than the stock has delivered lately.")}
              </p>
            )}
          </Card>
        ) : (
          <Card className="desk-span-4" title="Peers" subtitle={`${company.industry ?? company.sector} · largest first`}>
            <PeerList peers={peers} />
          </Card>
        )}

        <Card className="desk-span-4" title="Ownership" subtitle="13F institutional holdings and short interest">
          {institutional.isPending ? (
            <div style={{ display: "grid", gap: 8 }}>
              <Shimmer height={16} />
              <Shimmer height={16} width="70%" />
              <span className="desk-muted" style={{ fontSize: 12 }}>Reading institutional filings…</span>
            </div>
          ) : institutional.isError ? (
            <div className="desk-empty" style={{ padding: "6px 0" }}>Institutional holdings could not be read right now.</div>
          ) : institutionalData && institutionalData.holders > 0 ? (
            <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
              <Stat label={`Institutions holding (${fmtDate(institutionalData.quarterDate, "short")})`} value={institutionalData.holders.toLocaleString("en-US")} />
              {/* the summary reports both shares in percent units (25.2 = 25.2%) */}
              <Stat label="Share of stock held" value={fmtPct(institutionalData.ownershipPct === null ? null : institutionalData.ownershipPct / 100, 1, false)} />
              <Stat label="Change in shares held, quarter on quarter" value={<Delta value={institutionalData.qoqSharesDeltaPct === null ? null : institutionalData.qoqSharesDeltaPct / 100} digits={1} />} />
              {institutionalData.top.slice(0, 3).map((holder) => <Stat key={holder.fundName} label={entityName(holder.fundName)} value={fmtCap(holder.valueUsd)} />)}
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: "6px 0" }}>No institutional holdings are stored for this company.</div>
          )}
          {short?.sharesShort ? (
            <div className="desk-stats" style={{ gridTemplateColumns: "1fr", marginTop: 6 }}>
              <Stat label={`Short interest (${fmtDate(short.settlementDate, "short")})`} value={`${fmtCompact(short.sharesShort)} shares`} />
              {short.shortPercentOfFloat ? <Stat label="Share of float sold short" value={fmtPct(short.shortPercentOfFloat, 2, false)} /> : null}
              {short.shortRatio ? <Stat label="Days to cover" value={fmtNum(short.shortRatio, 1)} /> : null}
            </div>
          ) : null}
        </Card>

        <Card className="desk-span-7" title="Insider transactions" subtitle="Form 4 filings by officers and directors, newest first">
          {insiders.isLoading ? (
            <Shimmer height={160} />
          ) : insiders.data?.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ position: "static" }}>Date</th>
                    <th style={{ position: "static" }}>Insider</th>
                    <th style={{ position: "static" }}>Transaction</th>
                    <th className="num" style={{ position: "static" }}>Shares</th>
                    <th className="num" style={{ position: "static" }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {insiders.data.slice(0, 10).map((trade) => (
                    <tr key={trade.id} style={{ cursor: "default" }}>
                      <td>{fmtDate(trade.tradeDate ?? trade.filingDate, "short")}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {trade.insiderName ? personName(trade.insiderName) : "—"}
                        {trade.insiderRole && <span className="desk-muted"> · {trade.insiderRole}</span>}
                      </td>
                      <td>
                        {INSIDER_CODES[trade.code] ?? trade.code}
                        {trade.is10b5 && <span className="desk-badge" style={{ marginLeft: 6, height: 18 }} title="Executed under a Rule 10b5-1 trading plan">Plan</span>}
                      </td>
                      <td className="num">{fmtCompact(trade.shares)}</td>
                      <td className="num">{trade.shares && trade.price ? fmtCap(trade.shares * trade.price) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty">No insider transactions are stored for this company.</div>
          )}
        </Card>

        <Card className="desk-span-5" title={isPresentation && company.options ? "Peers" : "Compared with the index"} subtitle={isPresentation && company.options ? `${company.industry ?? company.sector} · largest first` : "Returns of this company, its sector and the S&P 500"}>
          {isPresentation && company.options ? <PeerList peers={peers} /> : <Comparison company={company} />}
        </Card>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 22 }}>
        <Link className="desk-button" to={`/company/${encodeURIComponent(company.registryTicker)}`}>
          Full analysis in the classic view <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
        <span className="desk-muted" style={{ fontSize: 12.5 }}>Financial statements, filings, valuation and sentiment are in the classic company page.</span>
      </div>
    </div>
  );
}

function PeerList({ peers }: { peers: DeskCompany[] }) {
  if (!peers.length) return <div className="desk-empty">No peers in the index.</div>;
  return (
    <div>
      {peers.map((peer) => (
        <CompanyLink key={peer.cik} company={peer} className="desk-list-row">
          <span className="desk-list-main">
            <span className="desk-ticker" style={{ minWidth: 52 }}>{peer.ticker}</span>
            <span className="name">{peer.name}</span>
          </span>
          <span className="desk-list-side">
            <span className="desk-muted" style={{ fontSize: 12 }}>{fmtCap(peer.marketCap)}</span>
            <Delta value={peer.returns.d1} digits={2} />
          </span>
        </CompanyLink>
      ))}
    </div>
  );
}

function Comparison({ company }: { company: DeskCompany }) {
  const snapshot = useDeskSnapshot();
  const sector = snapshot.data?.sectors.find((row) => row.name === company.sector) ?? null;
  const benchmark = snapshot.data?.benchmark ?? null;
  const rows = [
    { label: company.ticker, returns: company.returns },
    ...(sector ? [{ label: `${company.sector} sector`, returns: sector.returns }] : []),
    ...(benchmark ? [{ label: `S&P 500 (${benchmark.ticker})`, returns: benchmark.returns }] : []),
  ];
  const periods = ["m1", "ytd", "y1"] as const;
  return (
    <table className="desk-table" style={{ fontSize: 12.5 }}>
      <thead>
        <tr>
          <th style={{ position: "static" }} />
          {periods.map((period) => <th key={period} className="num" style={{ position: "static" }}>{periodLabel(period)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} style={{ cursor: "default" }}>
            <td style={{ fontWeight: 560 }}>{row.label}</td>
            {periods.map((period) => <td key={period} className="num"><Delta value={row.returns[period]} digits={1} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
