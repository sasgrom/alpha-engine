import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, ChevronDown, Command, Download, Gauge, Layers, LayoutGrid, LogOut, Moon, ShieldCheck, Sparkles, Sun, TrendingDown, TrendingUp } from "lucide-react";
import { rememberView } from "@/desk/preferences";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { calculatePriceAnalytics, formatTerminalMoney, formatTerminalPct, terminalChangePct, type PriceAnalytics, type TerminalPriceBar } from "@/terminal/terminal-data";
import { DisclosureTimeline, DrawdownChart, MarketLeaders, ReturnHistogram, ScenarioPanel, SectorDonut, TerminalPriceChart, WatchlistTable, type ScenarioReport } from "@/terminal/TerminalCharts";
import "@/terminal/terminal.css";

type Theme = "day" | "night";
type Range = "3M" | "1Y" | "ALL";

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useCountUp(value: number | null | undefined, duration = 650) {
  const [display, setDisplay] = useState(value ?? 0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    if (reduced) { setDisplay(value); return; }
    const from = display;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);
  return display;
}

function Reveal({ children, className = "", index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`terminal-reveal ${visible ? "is-visible" : ""} ${className}`} style={{ "--reveal-index": index } as CSSProperties}>{children}</div>;
}

function InfoNote({ children }: { children: ReactNode }) {
  return <details className="terminal-info"><summary aria-label="About this panel">i</summary><div>{children}</div></details>;
}

function CardHeading({ eyebrow, title, subtitle, aside }: { eyebrow: string; title: string; subtitle?: string; aside?: ReactNode }) {
  return (
    <div className="terminal-card-heading">
      <div><span className="terminal-eyebrow">{eyebrow}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {aside}
    </div>
  );
}

function Metric({ label, value, detail, tone = "neutral", icon }: { label: string; value: string; detail: string; tone?: "positive" | "negative" | "neutral"; icon: ReactNode }) {
  return <div className={`terminal-metric ${tone}`}><span className="terminal-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function TerminalSkeleton() {
  return <div className="terminal-skeleton"><span /><span /><span /><span /></div>;
}

export default function Terminal() {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const reducedMotion = useReducedMotion();
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("alpha.terminal.theme") === "day" ? "day" : "night");
  const [focus, setFocus] = useState("AAPL");
  const [range, setRange] = useState<Range>("1Y");
  const [scenario, setScenario] = useState<ScenarioReport | null>(null);
  useEffect(() => localStorage.setItem("alpha.terminal.theme", theme), [theme]);

  const universe = trpc.universe.list.useQuery({ search: "", onlyUniverse: true, page: 0, pageSize: 100 });
  const screener = trpc.screener.table.useQuery();
  const filings = trpc.dashboard.latestFilings.useQuery({ limit: 7 }, { refetchInterval: 60_000 });
  const companies = useMemo(() => (universe.data?.rows ?? []).map((row) => ({ cik: row.cik, ticker: row.ticker, name: row.name ?? row.ticker, sector: row.sector ?? row.sicDescription ?? null })), [universe.data]);
  useEffect(() => {
    if (companies.length && !companies.some((row) => row.ticker === focus)) setFocus(companies[0].ticker);
  }, [companies, focus]);
  const screenerRows = screener.data?.rows ?? [];
  const focusRow = screenerRows.find((row) => row.ticker === focus);
  const focusCompany = companies.find((row) => row.ticker === focus);
  const cik = focusRow?.cik ?? focusCompany?.cik ?? 0;
  const quote = trpc.prices.quote.useQuery({ cik }, { enabled: cik > 0 });
  const history = trpc.prices.history.useQuery({ cik, range }, { enabled: cik > 0 && quote.data?.available === true });
  const events = trpc.events.byCompany.useQuery({ cik }, { enabled: cik > 0 && quote.data?.available === true });

  useEffect(() => {
    let active = true;
    fetch("/reports/macro-scenarios.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (active) setScenario(value); })
      .catch(() => { if (active) setScenario(null); });
    return () => { active = false; };
  }, []);

  const bars = useMemo<TerminalPriceBar[]>(() => (history.data?.bars ?? []).filter((bar) => bar.close !== null).map((bar) => ({ date: bar.date, close: bar.close as number, volume: bar.volume })), [history.data]);
  const analytics = useMemo<PriceAnalytics>(() => calculatePriceAnalytics(bars), [bars]);
  const eventDates = useMemo(() => {
    if (!bars.length) return [];
    const dates = new Set(bars.map((bar) => bar.date));
    return (events.data ?? []).map((event) => event.eventDate).filter((date) => dates.has(date));
  }, [bars, events.data]);
  const sectorRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const company of companies) counts.set(company.sector || "Unclassified", (counts.get(company.sector || "Unclassified") ?? 0) + 1);
    return [...counts.entries()].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count);
  }, [companies]);
  const latestPrice = quote.data?.price ?? focusRow?.price ?? null;
  const animatedPrice = useCountUp(latestPrice);
  const changePct = terminalChangePct(quote.data, focusRow?.changePct);
  const positive = (changePct ?? 0) >= 0;
  const tableDate = screener.data?.asOf?.slice(0, 16).replace("T", " ");

  if (isLoading || !user) return <div className="terminal-root terminal-loading" data-theme={theme}><Command size={28} /><span>Preparing your research terminal…</span></div>;

  return (
    <div className="terminal-root" data-theme={theme} data-reduced-motion={reducedMotion ? "true" : "false"}>
      <div className="terminal-ambient" aria-hidden="true" />
      <header className="terminal-header">
        <Link to="/terminal" className="terminal-brand"><span className="terminal-brand-mark"><Activity size={18} /></span><span><strong>ALPHA</strong><small>RESEARCH TERMINAL</small></span></Link>
        <nav className="terminal-mode-nav" aria-label="Experience">
          <span className="active"><Sparkles size={14} /> Terminal</span>
          <Link to="/universe"><Layers size={14} /> Legacy</Link>
          <Link to="/desk" onClick={() => rememberView("desk")}><LayoutGrid size={14} /> New view</Link>
        </nav>
        <div className="terminal-header-actions">
          <button type="button" className="terminal-theme-toggle" role="switch" aria-checked={theme === "night"} aria-label={`Switch to ${theme === "night" ? "day" : "night"} theme`} onClick={() => setTheme(theme === "night" ? "day" : "night")}>
            <Sun size={14} /><span className="terminal-theme-track"><span /></span><Moon size={14} />
          </button>
          <span className="terminal-user"><span>{(user.name ?? "User").slice(0, 2).toUpperCase()}</span><strong>{user.name ?? "User"}</strong></span>
          <button type="button" className="terminal-icon-button" aria-label="Sign out" onClick={logout}><LogOut size={16} /></button>
        </div>
      </header>

      <div className="terminal-commandbar">
        <label><span>FOCUS COMPANY</span><span className="terminal-select-wrap"><select value={focus} onChange={(event) => setFocus(event.target.value)}>{companies.map((company) => <option key={company.cik} value={company.ticker}>{company.ticker} · {company.name}</option>)}</select><ChevronDown size={14} /></span></label>
        <div className="terminal-command-stats"><span><i className="terminal-live-dot" /> Latest close <strong>{quote.data?.asOf ?? "—"}</strong></span><span>Universe <strong>{companies.length}</strong></span><span>Snapshot <strong>{tableDate ?? "loading"}</strong></span></div>
        <span className="terminal-research-badge"><ShieldCheck size={13} /> Research only · not investment advice</span>
      </div>

      <main className="terminal-main">
        <Reveal className="terminal-hero" index={0}>
          <div className="terminal-hero-copy">
            <span className="terminal-eyebrow">YOUR MARKET, IN CONTEXT</span>
            <h1>Good to see you, {user.name?.split(" ")[0] ?? "there"}.<br /><em>Let’s read the evidence.</em></h1>
            <p>A clear view of your research universe: price trends, risk, sector leadership, macro scenarios and the filings behind them.</p>
            <div className="terminal-hero-actions"><a href="#focus-chart" className="terminal-primary-action">Explore {focus}<ArrowDownRight size={16} /></a><Link to={`/company/${focus}`} className="terminal-text-action">Open company in Legacy <ArrowUpRight size={14} /></Link></div>
          </div>
          <div className="terminal-hero-quote">
            <span className="terminal-quote-label">{focus} · {focusCompany?.name ?? focusRow?.name ?? "Company"}</span>
            <div className="terminal-quote-price"><span>$</span>{latestPrice === null ? "—" : formatTerminalMoney(animatedPrice)}</div>
            <div className={`terminal-quote-change ${positive ? "positive" : "negative"}`}>{positive ? <TrendingUp size={17} /> : <TrendingDown size={17} />}<strong>{formatTerminalPct(changePct, 2, true)}</strong><span>today</span></div>
            <small>{quote.data?.quality ?? "Latest available"} · {quote.data?.currency ?? "USD"} · end of day</small>
            <div className="terminal-quote-spark"><TerminalPriceSpark bars={bars.slice(-32)} positive={(analytics.totalReturn ?? 0) >= 0} /></div>
          </div>
        </Reveal>

        <Reveal className="terminal-metrics" index={1}>
          <Metric label="Universe" value={String(companies.length)} detail={`${sectorRows.length} sector groups`} icon={<BookOpen size={17} />} />
          <Metric label="Period return" value={formatTerminalPct(analytics.totalReturn, 1, true)} detail={`${range} · ${bars.length} daily closes`} tone={(analytics.totalReturn ?? 0) >= 0 ? "positive" : "negative"} icon={<Activity size={17} />} />
          <Metric label="Annualized volatility" value={formatTerminalPct(analytics.annualizedVolatility, 1)} detail="Daily returns × √252" icon={<Gauge size={17} />} />
          <Metric label="Maximum drawdown" value={formatTerminalPct(analytics.maxDrawdown, 1)} detail={`Best day ${formatTerminalPct(analytics.bestDay, 1, true)} · worst ${formatTerminalPct(analytics.worstDay, 1, true)}`} tone="negative" icon={<TrendingDown size={17} />} />
        </Reveal>

        <div className="terminal-grid">
          <Reveal className="terminal-card span-8" index={2}>
            <section id="focus-chart">
              <CardHeading eyebrow={`${focus} · PRICE STRUCTURE`} title="Trend, volume and earnings in one frame" subtitle={`${focusCompany?.name ?? focusRow?.name ?? "Company"} · daily close history · hover to inspect`} aside={<InfoNote>The area shows closing price, the dashed line the 20-day average, and shaded bars relative volume. Earnings markers are dated disclosures, not trade signals.</InfoNote>} />
              <div className="terminal-range-tabs" role="tablist" aria-label="Price range">{(["3M", "1Y", "ALL"] as Range[]).map((item) => <button key={item} type="button" role="tab" aria-selected={range === item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
              {history.isLoading ? <TerminalSkeleton /> : bars.length ? <TerminalPriceChart bars={bars} events={eventDates} reducedMotion={reducedMotion} /> : <div className="terminal-empty"><strong>No price history for {focus} yet</strong><p>Select another company or review its other evidence in Legacy.</p></div>}
              <div className="terminal-source-line"><span>{quote.data?.quality ?? "Latest available"} · {quote.data?.currency ?? "USD"} · {quote.data?.asOf ?? "latest available"}</span><Link to={`/company/${focus}`}>Full price detail <ArrowUpRight size={12} /></Link></div>
            </section>
          </Reveal>

          <Reveal className="terminal-card span-4" index={3}>
            <CardHeading eyebrow="UNIVERSE COMPOSITION" title="Sectors, not just symbols" subtitle="Composition by company count · a research universe, not capital allocation" aside={<InfoNote>This is a count of companies in your research universe, not capital allocation or a recommended portfolio.</InfoNote>} />
            <SectorDonut rows={sectorRows} reducedMotion={reducedMotion} />
            <div className="terminal-source-line"><span>{companies.length} active memberships</span><Link to="/universe">Manage in Legacy <ArrowUpRight size={12} /></Link></div>
          </Reveal>

          <Reveal className="terminal-card span-4" index={4}>
            <CardHeading eyebrow="DOWNSIDE PROFILE" title="Where the trend gave back" subtitle="Peak-to-trough drawdown over the selected period" aside={<InfoNote>Drawdown measures distance below the previous peak. It describes historical loss from a high point, not the probability of a future loss.</InfoNote>} />
            <div className="terminal-chart-stat"><strong>{formatTerminalPct(analytics.maxDrawdown, 1)}</strong><span>maximum drawdown</span></div>
            <DrawdownChart analytics={analytics} reducedMotion={reducedMotion} />
          </Reveal>

          <Reveal className="terminal-card span-4" index={5}>
            <CardHeading eyebrow="RETURN DISTRIBUTION" title="What a typical day looked like" subtitle="Frequency of daily returns · positive, negative and mixed bins" aside={<InfoNote>Each bar counts trading days in a return interval. A narrow distribution indicates less daily dispersion; tails show unusually strong or weak days.</InfoNote>} />
            <div className="terminal-chart-stat"><strong>{formatTerminalPct(analytics.positiveShare, 0)}</strong><span>positive trading days</span></div>
            <ReturnHistogram analytics={analytics} reducedMotion={reducedMotion} />
          </Reveal>

          <Reveal className="terminal-card span-4" index={6}>
            <CardHeading eyebrow="RELATIVE MOVEMENT" title="Leaders meet laggards" subtitle="Daily change across the visible universe · select a row to refocus" />
            <MarketLeaders rows={screenerRows} onSelect={setFocus} />
            <div className="terminal-source-line"><span>Latest computed universe snapshot</span><Link to="/screener">Full screener <ArrowUpRight size={12} /></Link></div>
          </Reveal>

          <Reveal className="terminal-card span-7" index={7}>
            <CardHeading eyebrow="MACRO SCENARIO BOARD" title="If the inputs move, what changes?" subtitle="Rates, oil, dollar and credit · actual baselines and reviewed scenarios" aside={<InfoNote>Scenario values are conditional calculations from the reviewed snapshot. They are not forecasts and do not imply a directional position.</InfoNote>} />
            <ScenarioPanel report={scenario} />
          </Reveal>

          <Reveal className="terminal-card span-5" index={8}>
            <CardHeading eyebrow="DISCLOSURE TIMELINE" title="The filings behind the numbers" subtitle="Latest documents from companies in your universe" aside={<InfoNote>These are primary company disclosures. Dates show when each filing became public; external links open the official SEC archive.</InfoNote>} />
            <DisclosureTimeline filings={filings.data ?? []} />
          </Reveal>

          <Reveal className="terminal-card span-12" index={9}>
            <CardHeading eyebrow="UNIVERSE AT A GLANCE" title="A watchlist you can actually read" subtitle="Largest companies by market capitalization · select any ticker to update the terminal" aside={<button type="button" className="terminal-export" onClick={() => downloadFocus({ focus, range, bars, analytics })}><Download size={14} /> Export focus data</button>} />
            <WatchlistTable rows={screenerRows} onSelect={setFocus} />
            <div className="terminal-source-line"><span>Computed {tableDate ?? "latest available"} · null values are not treated as zero</span><Link to="/screener">Explore all columns <ArrowUpRight size={12} /></Link></div>
          </Reveal>
        </div>

        <footer className="terminal-footer"><span><Command size={13} /> ALPHA RESEARCH TERMINAL</span><p>Retail-friendly presentation of research evidence. Prices are end-of-day and scenarios are conditional, never guaranteed outcomes.</p><Link to="/universe">Switch to Legacy <ArrowUpRight size={12} /></Link></footer>
      </main>
    </div>
  );
}

function TerminalPriceSpark({ bars, positive }: { bars: TerminalPriceBar[]; positive: boolean }) {
  if (bars.length < 2) return null;
  const width = 260;
  const height = 72;
  const values = bars.map((bar) => bar.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = bars.map((bar, index) => `${index / (bars.length - 1) * width},${height - (bar.close - min) / span * (height - 8)}`).join(" ");
  const area = `0,${height} ${points} ${width},${height}`;
  return <svg className="terminal-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent price sparkline"><polygon points={area} className={positive ? "spark-fill-positive" : "spark-fill-negative"} /><polyline points={points} className={positive ? "spark-line-positive" : "spark-line-negative"} /></svg>;
}

function downloadFocus({ focus, range, bars, analytics }: { focus: string; range: Range; bars: TerminalPriceBar[]; analytics: PriceAnalytics }) {
  const payload = { ticker: focus, range, exportedAt: new Date().toISOString(), bars, analytics: { totalReturn: analytics.totalReturn, annualizedVolatility: analytics.annualizedVolatility, maxDrawdown: analytics.maxDrawdown, bestDay: analytics.bestDay, worstDay: analytics.worstDay } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${focus}-${range}-terminal-evidence.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
