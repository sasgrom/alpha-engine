import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Check, Download, Plus, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { DESK_PERIODS, type DeskCompany } from "@contracts/desk-snapshot";
import { PriceChart, type ImpliedCone } from "../charts/PriceChart";
import { Card, CompanyLink, Delta, Notice, RangeBar, Segmented, Shimmer, TickerMark } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { findCompany, impliedMoveFor, peersOf, periodLabel, searchCompanies, useDeskSnapshot, useWatchlist } from "../data";
import { DevNotes } from "../DevNotes";
import { daysBetween, fmtCap, fmtClock, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, localToday, relativeDay } from "../format";
import { useDeskIntraday } from "../intraday";
import { rememberTicker } from "../preferences";
import { CompanyActions } from "./company/Actions";
import { CompanyFilings } from "./company/Filings";
import { CompanyGuidance } from "./company/Guidance";
import { CompanyHolders } from "./company/Holders";
import { CompanyInsiders } from "./company/Insiders";
import { CompanyNews } from "./company/News";
import { OptionChainDialog } from "./company/OptionChain";
import { CompanyRisk } from "./company/Risk";
import { CompanyStatements } from "./company/Statements";
import { CompanyPeers, TradingStrip } from "./company/Trading";

type DailyRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";
type Range = "1D" | "5D" | DailyRange;
const RANGES: { value: Range; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "5D", label: "5D" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "YTD", label: "YTD" },
  { value: "1Y", label: "1Y" },
  { value: "5Y", label: "5Y" },
  { value: "ALL", label: "Max" },
];

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="desk-stat" title={title}>
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
  const [chainOpen, setChainOpen] = useState(false);
  const watch = useWatchlist();
  const cik = company?.cik ?? 0;
  // 1D and 5D are the same chart drawn from the 5-minute session snapshots; longer ranges use the daily closes
  const isIntraday = range === "1D" || range === "5D";
  const history = trpc.prices.history.useQuery({ cik, range: isIntraday ? "1M" : (range as DailyRange) }, { enabled: cik > 0 && !isIntraday, staleTime: 5 * 60_000, placeholderData: (previous) => previous });
  const intraday = useDeskIntraday(company?.ticker ?? "", range === "5D" ? 5 : 1, isIntraday && cik > 0);
  // the chart's earnings markers: the company's earnings releases in its filings list (the same query the Filings card makes)
  const filings = trpc.desk.companyFilings.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const shortInterest = trpc.company.shortInterest.useQuery({ cik }, { enabled: cik > 0, staleTime: 10 * 60_000 });

  useEffect(() => {
    if (company) rememberTicker(company.ticker);
  }, [company]);

  const dailyPoints = useMemo(() => (history.data?.bars ?? []).filter((bar) => bar.close !== null).map((bar) => ({ date: bar.date, close: bar.close as number })), [history.data]);
  const intradayPoints = useMemo(() => (intraday.data?.sessions ?? []).flatMap((session) => session.company.bars.map((bar) => ({ date: bar.end, close: bar.c }))), [intraday.data]);
  const points = isIntraday ? intradayPoints : dailyPoints;
  const previousClose = range === "1D" ? (intraday.data?.sessions.at(-1)?.company.previousClose ?? null) : null;
  // the numbers a 1D/5D chart owes the reader: open, range, volume and the change against the close before the window
  const sessionStats = useMemo(() => {
    const sessions = intraday.data?.sessions ?? [];
    const bars = range === "1D" ? (sessions.at(-1)?.company.bars ?? []) : sessions.flatMap((session) => session.company.bars);
    if (!bars.length) return null;
    const volumes = bars.map((bar) => bar.v).filter((value): value is number => value !== null);
    const reference = range === "1D" ? (sessions.at(-1)?.company.previousClose ?? null) : (sessions[0]?.company.previousClose ?? null);
    const last = bars.at(-1)!.c;
    return {
      open: bars[0].o, high: Math.max(...bars.map((bar) => bar.h)), low: Math.min(...bars.map((bar) => bar.l)), last,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null, change: reference ? last / reference - 1 : null,
    };
  }, [intraday.data, range]);
  const lastEarnings = company?.lastEarnings ?? null;
  const eventDates = useMemo(() => {
    const dates = new Set<string>((filings.data?.filings ?? []).filter((filing) => filing.earnings).map((filing) => filing.period ?? filing.filed));
    if (lastEarnings) dates.add(lastEarnings);
    return [...dates];
  }, [filings.data, lastEarnings]);
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
  const short = shortInterest.data?.current ?? null;

  const downloadCsv = () => {
    const lines = [isIntraday ? "time,price" : "date,close", ...points.map((point) => `${point.date},${point.close}`)];
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
          <button
            type="button"
            className="desk-button desk-follow"
            style={{ height: 30, marginBottom: 8 }}
            aria-pressed={watch.ciks.has(company.cik)}
            disabled={watch.busy || watch.isLoading}
            onClick={() => (watch.ciks.has(company.cik) ? watch.unfollow(company.cik) : watch.follow(company))}
            title={watch.error ?? undefined}
          >
            {watch.ciks.has(company.cik) ? <><Check size={14} aria-hidden="true" /> Following</> : <><Plus size={14} aria-hidden="true" /> Follow</>}
          </button>
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
          subtitle={
            isIntraday
              ? intraday.data
                ? intraday.data.marketOpen
                  ? <><span className="desk-live-dot" aria-hidden="true" />Live · intraday prices as of {fmtClock(intraday.data.asOf)}{intraday.data.delayed === true ? " · delayed quotes" : ""}</>
                  : <>Market closed · {range === "1D" ? `${fmtDate(intraday.data.session, "weekday")} session` : `${intraday.data.sessions.length} session${intraday.data.sessions.length === 1 ? "" : "s"} to ${fmtDate(intraday.data.session, "short")}`} · intraday prices</>
                : "Intraday prices"
              : cone && isPresentation ? "Daily closes · the shaded cone is the move options price in over the next weeks" : "Daily closes, adjusted for splits and dividends"
          }
          action={<Segmented label="Chart range" options={RANGES} value={range} onChange={setRange} />}
        >
          {isIntraday ? (
            <div className={intraday.isFetching && intraday.data ? "desk-refetching" : undefined}>
              {intraday.isLoading ? <Shimmer height={320} /> : intraday.error ? <div className="desk-empty">The 5-minute prices could not be loaded: {intraday.error.message}</div> : points.length >= 2 ? <PriceChart points={points} mode="intraday" baseline={previousClose} palette={palette} /> : <div className="desk-empty">No 5-minute prices are stored for this company yet.</div>}
            </div>
          ) : (
            <div className={history.isFetching && history.data ? "desk-refetching" : undefined}>
              {history.isLoading ? <Shimmer height={320} /> : points.length >= 2 ? <PriceChart points={points} events={eventDates} cone={isPresentation ? cone : null} palette={palette} /> : <div className="desk-empty">No stored price history for this range.</div>}
              <TradingStrip cik={cik} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12, flexWrap: "wrap" }}>
            {isIntraday ? (
              <span className="desk-legend" aria-label="Session numbers">
                {sessionStats && (
                  <>
                    {range === "1D" && <span>Open <strong>{fmtPrice(sessionStats.open)}</strong></span>}
                    <span>High <strong>{fmtPrice(sessionStats.high)}</strong></span>
                    <span>Low <strong>{fmtPrice(sessionStats.low)}</strong></span>
                    {sessionStats.volume !== null && <span>Volume <strong>{fmtCompact(sessionStats.volume)}</strong></span>}
                    {sessionStats.change !== null && <span>{range === "1D" ? "vs previous close" : "over the window"} <Delta value={sessionStats.change} digits={2} /></span>}
                  </>
                )}
              </span>
            ) : (
              <span className="desk-legend">
                <span><span className="desk-swatch" style={{ background: palette.accent, height: 3, borderRadius: 2 }} />Close</span>
                <span><span className="desk-swatch" style={{ background: palette.ink, borderRadius: 10, width: 8, height: 8 }} />Earnings report</span>
                {cone && isPresentation && <span><span className="desk-swatch" style={{ background: palette.accent, opacity: 0.25 }} />Options-implied range</span>}
              </span>
            )}
            <button type="button" className="desk-button" style={{ height: 30 }} onClick={downloadCsv} disabled={!points.length}>
              <Download size={14} aria-hidden="true" /> {isIntraday ? "Prices as CSV" : "Closes as CSV"}
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

        <CompanyRisk points={dailyPoints} rangeLabel={RANGES.find((item) => item.value === range)?.label ?? range} intraday={isIntraday} />

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
            <button type="button" className="desk-button" style={{ marginTop: 12 }} onClick={() => setChainOpen(true)}>Open the option chain</button>
            {chainOpen && <OptionChainDialog ticker={company.ticker} onClose={() => setChainOpen(false)} />}
          </Card>
        ) : (
          <Card className="desk-span-4" title="Peers" subtitle="Measured: daily moves together, beyond the market · correlation · this week's trading">
            <CompanyPeers cik={cik} fallback={peers} />
          </Card>
        )}

        <Card className="desk-span-4" title="Ownership" subtitle="Fund holdings from their 13F reports, and short interest">
          <CompanyHolders cik={cik} />
          {short?.sharesShort ? (
            <div className="desk-stats" style={{ gridTemplateColumns: "1fr", marginTop: 6 }}>
              <Stat label={`Short interest (${fmtDate(short.settlementDate, "short")})`} value={`${fmtCompact(short.sharesShort)} shares`} />
              {short.shortPercentOfShares !== null && short.shareCount ? (
                <Stat
                  label="Share of shares sold short"
                  value={fmtPct(short.shortPercentOfShares, 1, false)}
                  title={`Shares short over ${fmtCompact(short.shareCount.shares)} shares (${short.shareCount.kind === "outstanding" ? "outstanding at" : "weighted average for the quarter to"} ${fmtDate(short.shareCount.end, "short")}, filed ${fmtDate(short.shareCount.filed, "short")}). All share classes; not the float.`}
                />
              ) : null}
              {short.shortRatio ? <Stat label="Days to cover" value={fmtNum(short.shortRatio, 1)} /> : null}
            </div>
          ) : null}
        </Card>

        <CompanyInsiders cik={cik} />

        <Card className="desk-span-5" title={isPresentation && company.options ? "Peers" : "Compared with the index"} subtitle={isPresentation && company.options ? "Measured: daily moves together, beyond the market · correlation · this week's trading" : "Returns of this company, its sector and the S&P 500"}>
          {isPresentation && company.options ? <CompanyPeers cik={cik} fallback={peers} /> : <Comparison company={company} />}
        </Card>

        <CompanyStatements cik={cik} />
        {isPresentation && <CompanyGuidance cik={cik} />}
        <CompanyActions cik={cik} />
        <CompanyNews cik={cik} />
        <CompanyFilings cik={cik} />
      </div>

      <DevNotes page="company" />
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
    <div className="desk-table-wrap">
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
    </div>
  );
}
