import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { DESK_PERIODS, type DeskCompany, type DeskPeriod } from "@contracts/desk-snapshot";
import { MarketMap, DivergingLegend } from "../charts/MarketMap";
import { SectorBars } from "../charts/SectorBars";
import { Sparkline } from "../charts/Sparkline";
import { Card, CompanyLink, Delta, Kpi, Notice, Segmented, Shimmer, TickerMark } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { earningsRadar, impliedMoveFor, marketBrief, movers, periodBreadth, periodLabel, useDeskSnapshot, useWatchlist } from "../data";
import { DevNotes } from "../DevNotes";
import { daysBetween, fmtDate, fmtNum, fmtPct, fmtPrice, localToday, relativeDay } from "../format";

const PERIOD_OPTIONS = DESK_PERIODS.map((period) => ({ value: period, label: periodLabel(period) }));

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

const FORM_LABELS: Record<string, string> = {
  "10-K": "Annual report",
  "10-Q": "Quarterly report",
  "8-K": "Current report",
  "8-K/A": "Current report, amended",
  "10-K/A": "Annual report, amended",
  "10-Q/A": "Quarterly report, amended",
  "DEF 14A": "Proxy statement",
  "4": "Insider transaction",
  "S-1": "Registration statement",
  "6-K": "Foreign issuer report",
  "20-F": "Foreign annual report",
};

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function MoverList({ rows, period }: { rows: DeskCompany[]; period: DeskPeriod }) {
  if (!rows.length) return <div className="desk-empty">No companies moved in this direction.</div>;
  return (
    <div>
      {rows.map((company) => (
        <CompanyLink key={company.cik} company={company} className="desk-list-row">
          <span className="desk-list-main">
            <TickerMark ticker={company.ticker} size={30} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span className="desk-ticker">{company.ticker}</span>
              <span className="name" style={{ fontSize: 12.5 }}>{company.name}</span>
            </span>
          </span>
          <span className="desk-list-side">
            <span className="desk-hide-narrow"><Sparkline values={company.spark.slice(-21)} width={72} height={24} /></span>
            <span style={{ minWidth: 72, textAlign: "right" }}>{fmtPrice(company.close)}</span>
            <Delta value={company.returns[period]} digits={2} className="desk-kpi-delta" />
          </span>
        </CompanyLink>
      ))}
    </div>
  );
}

export default function Today() {
  useDocumentTitle("Today");
  const navigate = useNavigate();
  const { palette, userName, isAdmin } = useDesk();
  const snapshot = useDeskSnapshot();
  const [period, setPeriod] = useState<DeskPeriod>("d1");
  const [moverSide, setMoverSide] = useState<"gainers" | "losers">("gainers");
  const watch = useWatchlist();
  const filings = trpc.dashboard.latestFilings.useQuery({ limit: 8 }, { staleTime: 60_000 });
  const macro = trpc.dashboard.macro.useQuery(undefined, { staleTime: 10 * 60_000 });

  const data = snapshot.data;
  const derived = useMemo(() => {
    if (!data) return null;
    return {
      breadth: periodBreadth(data.companies, period),
      movers: movers(data.companies, period, 6),
      radar: earningsRadar(data, 7, 14),
      brief: marketBrief(data),
      byCik: new Map(data.companies.map((company) => [company.cik, company])),
    };
  }, [data, period]);

  if (snapshot.isLoading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Shimmer height={64} width="50%" />
        <div className="desk-kpis">{Array.from({ length: 5 }, (_, k) => <Shimmer key={k} height={120} />)}</div>
        <Shimmer height={320} />
      </div>
    );
  }
  if (snapshot.error) return <Notice title="The market overview could not be loaded">{snapshot.error.message}</Notice>;
  if (!data || !derived) {
    return (
      <Notice title="The market overview is not ready yet">
        {isAdmin ? <>Build it on the home machine with <code>npx tsx scripts/build-desk-snapshot.mts</code>; the page picks it up without a restart.</> : "It is prepared after each market close. Please check back shortly."}
      </Notice>
    );
  }

  const { breadth, brief, byCik } = derived;
  const today = localToday();
  // projections already behind the viewer's today are not "coming up" any more
  const radar = { reported: derived.radar.reported, upcoming: derived.radar.upcoming.filter((company) => company.nextEarnings! >= today) };
  const benchmark = data.benchmark;
  const watchRows = watch.rows.map((row) => ({ row, company: byCik.get(row.cik) ?? null }));
  const ma200Share = data.breadth.withMa200 ? data.breadth.aboveMa200 / data.breadth.withMa200 : null;
  const upShare = breadth.measured ? breadth.up / breadth.measured : 0;
  const downShare = breadth.measured ? breadth.down / breadth.measured : 0;

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">{fmtDate(data.session, "long")} · S&amp;P 500 close</span>
          <h1>{greeting(userName)}</h1>
        </div>
        <Segmented label="Return period" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </div>

      <p className="desk-brief" aria-label="The session in brief">
        {brief.map((sentence, index) => (
          <span key={index}>
            {sentence.map((part, k) => (typeof part === "string" ? <span key={k}>{part}</span> : <strong key={k}>{part.strong}</strong>))}{" "}
          </span>
        ))}
      </p>

      <div className="desk-kpis">
        <Kpi
          label={benchmark ? `S&P 500 (${benchmark.ticker})` : "S&P 500"}
          value={benchmark ? fmtPrice(benchmark.close) : "—"}
          delta={benchmark && <><Delta value={benchmark.returns[period]} digits={2} /> <span className="desk-muted">{periodLabel(period)}</span></>}
        >
          {benchmark && <Sparkline values={benchmark.spark} width={180} height={34} label={`${benchmark.ticker} closes over three months`} />}
        </Kpi>
        <Kpi label={`Advancing · ${periodLabel(period)}`} value={fmtPct(upShare, 0, false)} note={`${breadth.up} up · ${breadth.down} down · ${breadth.flat} flat`}>
          <div className="desk-segbar" style={{ height: 8 }} aria-label={`${breadth.up} up, ${breadth.flat} flat, ${breadth.down} down`}>
            <span style={{ flex: Math.max(upShare, 0.001), background: palette.pos, padding: 0 }} />
            <span style={{ flex: Math.max(1 - upShare - downShare, 0.001), background: palette.mid, padding: 0 }} />
            <span style={{ flex: Math.max(downShare, 0.001), background: palette.neg, padding: 0 }} />
          </div>
        </Kpi>
        <Kpi label={`Median stock · ${periodLabel(period)}`} value={<Delta value={breadth.median} digits={2} />} note={`across ${breadth.measured} companies`} />
        <Kpi label="52-week highs / lows" value={<span>{data.breadth.newHighs} <span className="desk-muted" style={{ fontWeight: 400 }}>/</span> {data.breadth.newLows}</span>} note="closing extremes at the latest close" />
        <Kpi label="Above 200-day average" value={fmtPct(ma200Share, 0, false)} note={`${data.breadth.aboveMa200} of ${data.breadth.withMa200} companies`}>
          <div className="desk-meter" aria-hidden="true"><span style={{ width: `${(ma200Share ?? 0) * 100}%` }} /></div>
        </Kpi>
      </div>

      <div className="desk-grid">
        <Card
          className="desk-span-12"
          title={`Market map · ${periodLabel(period)}`}
          subtitle="Every company, grouped by sector, sized by market value, colored by return"
          action={<div style={{ display: "flex", alignItems: "center", gap: 18 }}><DivergingLegend period={period} palette={palette} /><Link className="desk-link desk-nowrap" to="/desk/markets">Full map <ArrowUpRight size={13} style={{ verticalAlign: -2 }} /></Link></div>}
        >
          <MarketMap companies={data.companies} period={period} sizeBy="cap" height={340} palette={palette} onOpen={(company) => navigate(`/desk/company/${encodeURIComponent(company.ticker)}`)} />
        </Card>

        <Card className="desk-span-7" title={`Sectors · ${periodLabel(period)}`} subtitle="Market-value weighted return of each sector · select one to screen it">
          <SectorBars sectors={data.sectors.filter((sector) => sector.name !== "Other")} period={period} palette={palette} onSelect={(sector) => navigate(`/desk/screener?sector=${encodeURIComponent(sector)}`)} />
        </Card>

        <Card className="desk-span-5" title={`Biggest moves · ${periodLabel(period)}`}>
          <div className="desk-tabs" role="tablist" aria-label="Direction">
            <button type="button" role="tab" aria-selected={moverSide === "gainers"} onClick={() => setMoverSide("gainers")}>Gainers</button>
            <button type="button" role="tab" aria-selected={moverSide === "losers"} onClick={() => setMoverSide("losers")}>Decliners</button>
          </div>
          <MoverList rows={moverSide === "gainers" ? derived.movers.gainers : derived.movers.losers} period={period} />
        </Card>

        <Card className="desk-span-6" title="Just reported" subtitle="Earnings reports of the last 7 days · move from the close before the report to the session after it">
          {radar.reported.length ? (
            <div>
              {radar.reported.slice(0, 8).map((company) => (
                <CompanyLink key={company.cik} company={company} className="desk-list-row">
                  <span className="desk-list-main">
                    <span className="desk-ticker" style={{ minWidth: 52 }}>{company.ticker}</span>
                    <span className="name">{company.name}</span>
                  </span>
                  <span className="desk-list-side">
                    <span className="desk-muted" style={{ fontSize: 12.5 }}>{fmtDate(company.lastEarnings, "short")}</span>
                    <Delta value={company.lastEarningsReaction} digits={1} />
                  </span>
                </CompanyLink>
              ))}
              {radar.reported.length > 8 && <div className="desk-muted" style={{ fontSize: 12.5, paddingTop: 8 }}>and {radar.reported.length - 8} more this week</div>}
            </div>
          ) : (
            <div className="desk-empty">No company in the index reported in the last week.</div>
          )}
        </Card>

        <Card className="desk-span-6" title="Coming up" subtitle="Projected report dates for the next two weeks · from each company's own reporting calendar">
          {radar.upcoming.length ? (
            <div>
              {radar.upcoming.slice(0, 8).map((company) => {
                const implied = impliedMoveFor(company, Math.max(1, daysBetween(data.session, company.nextEarnings!)));
                return (
                  <CompanyLink key={company.cik} company={company} className="desk-list-row">
                    <span className="desk-list-main">
                      <span className="desk-ticker" style={{ minWidth: 52 }}>{company.ticker}</span>
                      <span className="name">{company.name}</span>
                    </span>
                    <span className="desk-list-side">
                      {implied && <span className="desk-badge desk-hide-narrow" title={`Options price a move of about ±${fmtPct(implied.pct, 1, false)} over ${implied.days} days`}>±{fmtPct(implied.pct, 1, false)} implied</span>}
                      <span style={{ fontSize: 12.5 }}>{fmtDate(company.nextEarnings, "weekday")}</span>
                      <span className="desk-muted desk-hide-narrow" style={{ fontSize: 12, minWidth: 64, textAlign: "right" }}>{relativeDay(company.nextEarnings!, today)}</span>
                    </span>
                  </CompanyLink>
                );
              })}
            </div>
          ) : (
            <div className="desk-empty">No projected reports in the next two weeks.</div>
          )}
        </Card>

        <Card className="desk-span-12" title="Your watchlist" subtitle="Companies you follow" action={<Link className="desk-link" to="/desk/watchlist">Manage</Link>}>
          {watch.isLoading ? (
            <Shimmer height={90} />
          ) : watchRows.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {watchRows.map(({ row, company }) => (
                <CompanyLink key={row.cik} company={{ ticker: company?.ticker ?? row.ticker, cik: row.cik }} className="desk-card" style={{ padding: 14, display: "grid", gap: 8 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="desk-ticker" style={{ display: "block" }}>{company?.ticker ?? row.ticker}</span>
                      <span className="desk-muted" style={{ fontSize: 12, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company?.name ?? row.name}</span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="desk-num" style={{ display: "block", fontWeight: 560 }}>{fmtPrice(company?.close ?? null)}</span>
                      <Delta value={company ? company.returns[period] : null} digits={2} />
                    </span>
                  </span>
                  {company && <Sparkline values={company.spark} width={200} height={34} />}
                  <span className="desk-muted" style={{ fontSize: 12 }}>
                    {company?.nextEarnings ? `Next report ~${fmtDate(company.nextEarnings, "short")}` : company?.lastEarnings ? `Reported ${fmtDate(company.lastEarnings, "short")}` : company ? " " : "Outside the index"}
                  </span>
                </CompanyLink>
              ))}
            </div>
          ) : (
            <div className="desk-empty">Your watchlist is empty. Follow companies from the Watchlist page or from any company page.</div>
          )}
        </Card>

        <Card className="desk-span-7" title="Latest filings" subtitle="Newest SEC documents from your watchlist companies">
          {filings.isLoading ? (
            <Shimmer height={160} />
          ) : filings.data?.length ? (
            <div>
              {filings.data.map((filing) => (
                <a key={filing.id} className="desk-list-row" href={`https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accessionNo.replaceAll("-", "")}`} target="_blank" rel="noreferrer">
                  <span className="desk-list-main">
                    <span className="desk-ticker" style={{ minWidth: 52 }}>{byCik.get(filing.cik)?.ticker ?? filing.ticker}</span>
                    <span className="name">{FORM_LABELS[filing.form] ?? filing.form} <span className="desk-muted">· {filing.form}</span></span>
                  </span>
                  <span className="desk-list-side desk-muted" style={{ fontSize: 12.5 }}>
                    {fmtDate(filing.filingDate, "short")} <ArrowUpRight size={13} aria-hidden="true" />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="desk-empty">No filings yet for the companies you follow.</div>
          )}
        </Card>

        <Card className="desk-span-5" title="Macro backdrop" subtitle="Latest published values (FRED)">
          {macro.isLoading ? (
            <Shimmer height={160} />
          ) : macro.data?.length ? (
            <div>
              {macro.data.map((point) => (
                <div key={point.seriesId} className="desk-list-row">
                  <span className="desk-list-main"><span>{MACRO_LABELS[point.seriesId] ?? point.label}</span></span>
                  <span className="desk-list-side">
                    <strong className="desk-num" style={{ fontWeight: 560 }}>
                      {point.value === null ? "—" : point.unit === "pct" ? `${fmtNum(point.value, 2)}%` : fmtNum(point.value, point.unit === "index" ? 1 : 2)}
                    </strong>
                    <span className="desk-muted" style={{ fontSize: 12, minWidth: 54, textAlign: "right" }}>{fmtDate(point.date, "short")}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="desk-empty">No macro readings are stored yet.</div>
          )}
        </Card>
      </div>
      <DevNotes page="today" />
    </div>
  );
}
