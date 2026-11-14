import { useState } from "react";
import { Link } from "react-router";
import type { DeskIntradaySeries, DeskIntradaySession } from "@contracts/intraday";
import { INTRADAY_SNAPSHOT_LABEL } from "@contracts/intraday";
import { Card, Delta, Notice, Segmented, Shimmer } from "../components";
import { IntradayLineChart, IntradaySpark, IntradayVolumeChart } from "../charts/IntradayChart";
import { fmtClock, fmtDate, fmtDateTime, fmtPct, fmtPrice } from "../format";
import { useDeskIntraday, useDeskIntradayMarket } from "../intraday";

function StateLine({ session, asOf, marketOpen, delayed }: { session: string; asOf: string; marketOpen: boolean; delayed: boolean | null }) {
  return <span className="desk-muted" style={{ fontSize: 12.5 }}>{marketOpen ? "Open session" : `Last session · ${fmtDate(session, "short")}`} · as of {fmtClock(asOf)}{delayed === true && <span className="desk-badge" style={{ marginLeft: 7 }}>Delayed quotes</span>}</span>;
}

function returnPath(series: DeskIntradaySeries) {
  if (series.previousClose === null || series.previousClose <= 0) return [];
  return series.bars.map(bar => ({ time: bar.end, value: bar.c / series.previousClose! - 1 }));
}

function CompanySession({ session, ticker }: { session: DeskIntradaySession; ticker: string }) {
  const company = session.company;
  const price = company.bars.map(bar => ({ time: bar.end, value: bar.c }));
  const vwap = company.bars.flatMap(bar => bar.vwap === null ? [] : [{ time: bar.end, value: bar.vwap }]);
  return (
    <section aria-label={`${ticker} session ${session.date}`} style={{ borderTop: "1px solid var(--d-border)", paddingTop: 14, marginTop: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{fmtDate(session.date, "weekday")}</strong>
        <span className="desk-muted" style={{ fontSize: 12.5 }}>
          Previous close {fmtPrice(company.previousClose)} · VWAP {fmtPrice(company.vwap)} · opening gap {fmtPct(company.openGap, 2)}
          {company.delayed === true && <span className="desk-badge" style={{ marginLeft: 6 }}>Delayed</span>}
          {company.splitAdjusted && <span className="desk-badge" style={{ marginLeft: 6 }}>Earlier session rebased for split</span>}
        </span>
      </div>
      <IntradayLineChart label={`${ticker} price and VWAP on ${session.date}`} series={[{ name: ticker, points: price }, { name: "VWAP", color: "var(--d-pos)", points: vwap }]} previousClose={company.previousClose} markers={session.markers} valueKind="price" />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11.5 }} className="desk-muted"><span>Price</span><span>VWAP</span><span>Previous close · dashed</span><span>Volume below uses a separate axis</span></div>
      <IntradayVolumeChart bars={company.bars} label={`${ticker} snapshot volume on ${session.date}`} />
      <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Against SPY and {session.sector ? "the sector fund" : "its sector"} · return from previous close</h3>
      <IntradayLineChart label={`${ticker} against SPY and sector on ${session.date}`} series={[{ name: ticker, points: returnPath(company) }, { name: "SPY", points: returnPath(session.spy) }, ...(session.sector ? [{ name: "Sector fund", color: "var(--d-pos)", points: returnPath(session.sector) }] : [])]} baseline={0} valueKind="percent" height={180} />
      {session.markers.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{session.markers.map(marker => {
        const text = `${marker.label} · ${marker.time ? fmtDateTime(marker.time) : "time not stored"}`;
        return marker.sourceUrl ? <a key={`${marker.kind}-${marker.accessionNo}`} className="desk-badge desk-link" href={marker.sourceUrl} target="_blank" rel="noreferrer" title={text}>{text}</a> : <span key={`${marker.kind}-${marker.label}`} className="desk-badge" title={text}>{text}</span>;
      })}</div>}
    </section>
  );
}

export function IntradayCompanyPanel({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<"today" | "five">("today");
  const sessions = range === "today" ? 1 : 5;
  const query = useDeskIntraday(ticker, sessions, Boolean(ticker));
  return (
    <Card className="desk-span-12" title="Today / 5 days" subtitle={INTRADAY_SNAPSHOT_LABEL} action={<Segmented label="Intraday range" options={[{ value: "today", label: "Today" }, { value: "five", label: "5 days" }]} value={range} onChange={setRange} />}>
      {query.isLoading ? <Shimmer height={330} /> : query.error ? <Notice title="Intraday prices could not be loaded">{query.error.message}</Notice> : !query.data ? <div className="desk-empty">No 5-minute session snapshots are stored for this company yet.</div> : <>
        <StateLine session={query.data.session} asOf={query.data.asOf} marketOpen={query.data.marketOpen} delayed={query.data.delayed} />
        {query.data.status === "partial" && <p className="desk-muted" style={{ fontSize: 12 }}>Some requested sessions or comparison series are missing; only stored snapshots are shown.</p>}
        {query.data.sessions.map(session => <CompanySession key={session.date} session={session} ticker={query.data!.ticker} />)}
      </>}
    </Card>
  );
}

export function MarketIntradayPanel() {
  const query = useDeskIntradayMarket();
  return (
    <Card title="Through the day" subtitle={INTRADAY_SNAPSHOT_LABEL} className="desk-span-12">
      {query.isLoading ? <Shimmer height={280} /> : query.error ? <Notice title="The intraday market summary could not be loaded">{query.error.message}</Notice> : !query.data ? <div className="desk-empty">No 5-minute market session is stored yet.</div> : <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <StateLine session={query.data.session} asOf={query.data.asOf} marketOpen={query.data.marketOpen} delayed={query.data.delayed} />
          <span className="desk-muted" style={{ fontSize: 12 }}>{query.data.coverage.measured} of {query.data.coverage.expected} companies have a stored path</span>
        </div>
        {query.data.breadth.length === 0 ? <div className="desk-empty">The latest session has no company paths yet.</div> : <>
          <div className="desk-grid">
            <section className="desk-span-6"><h3 style={{ fontSize: 13 }}>Breadth · share above previous close</h3><IntradayLineChart label="Market breadth through the day" series={[{ name: "Above previous close", points: query.data.breadth.map(row => ({ time: row.time, value: row.share ?? 0 })) }]} baseline={0.5} valueKind="percent" height={190} /></section>
            <section className="desk-span-6"><h3 style={{ fontSize: 13 }}>SPY against the equal-weighted 500</h3><IntradayLineChart label="SPY against equal weight through the day" series={[{ name: "SPY", points: query.data.spy.points }, { name: "Equal-weighted 500", color: "var(--d-pos)", points: query.data.equalWeight.points }]} baseline={0} valueKind="percent" height={190} /></section>
          </div>
          <div className="desk-grid" style={{ marginTop: 16 }}>
            <section className="desk-span-7"><h3 style={{ fontSize: 13 }}>Sector funds · return from previous close</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>{query.data.sectors.map(row => <div key={row.ticker} className="desk-panel-inset" style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 5 }}><span><strong className="desk-ticker">{row.ticker}</strong><span className="desk-muted" style={{ display: "block", fontSize: 11 }}>{row.name}</span></span><Delta value={row.change} digits={2} /><div style={{ gridColumn: "1 / -1" }}><IntradaySpark points={row.points} width={165} height={26} label={`${row.ticker} through the day`} /></div></div>)}</div></section>
            <section className="desk-span-5"><h3 style={{ fontSize: 13 }}>Top movers · day path</h3>{query.data.movers.length ? query.data.movers.map(row => <Link key={row.ticker} to={`/desk/company/${encodeURIComponent(row.ticker)}`} className="desk-list-row"><span className="desk-list-main"><span className="desk-ticker">{row.ticker}</span><span className="name">{row.name}</span></span><span className="desk-list-side"><IntradaySpark points={row.points} width={82} height={25} label={`${row.ticker} through the day`} /><Delta value={row.change} digits={2} /></span></Link>) : <div className="desk-empty">No movers are stored yet.</div>}</section>
          </div>
        </>}
      </>}
    </Card>
  );
}
