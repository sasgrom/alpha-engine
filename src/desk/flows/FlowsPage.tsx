/**
 * Fund flows: what the tracked 13F filers bought and sold, quarter by quarter, where the money went and what it
 * earned. Two views of the same figures: the library (a hall to walk through) and the reading view (charts and
 * tables). Everything selected lives in the address, so a view can be linked.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { BookOpen, DoorOpen, Eye, Gamepad2, Info, Library, Minimize2, PanelRightClose, PanelRightOpen, Pause, Play, X } from "lucide-react";
import type { FlowQuarter, FundFlowsOverview } from "@contracts/fund-flows";
import { Card, Notice, Segmented, Shimmer } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtDate, fmtPct } from "../format";
import { FlowTape, FlowTimeline, RotationDiagram } from "./charts";
import { deflatorSince, quarterLabel, quarterSentence, standingOf, useFlowsCompany, useFlowsFund, useFlowsOverview, type Who } from "./data";
import type { StageSelection, StageTarget } from "./hall/stage";
import { webglAvailable } from "./hall/webgl";
import { CatalogPanel, CompanyPanel, FundPanel, QuarterPanel, Sentence, type FlowNav } from "./panels";

const Library3D = lazy(() => import("./Library3D"));

type View = "library" | "reading";
type Mode = "flow" | "outcome" | "held";
type Tab = "quarter" | "find" | "selected";

function useFlowState(overview: FundFlowsOverview | null | undefined) {
  const [params, setParams] = useSearchParams();
  const quarters = overview?.quarters ?? [];
  const row = quarters.find((quarter) => quarter.quarter === params.get("q")) ?? quarters.at(-1) ?? null;
  const fund = Number(params.get("fund")) || null;
  const company = Number(params.get("company")) || null;
  const sector = params.get("sector");
  const set = useCallback(
    (changes: Record<string, string | number | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return { params, row, fund, company, sector, set };
}

export default function FlowsPage() {
  useDocumentTitle("Fund flows");
  const { palette, theme, flowsOpen, audienceReady } = useDesk();
  const overview = useFlowsOverview(flowsOpen);
  const state = useFlowState(overview.data);
  const { row, fund, company, sector, set, params } = state;
  const canWalk = useMemo(() => webglAvailable(), []);
  const view: View = params.get("view") === "reading" || !canWalk ? "reading" : "library";
  const show = params.get("show");
  const mode: Mode = show === "outcome" ? "outcome" : show === "held" ? "held" : "flow";
  const real = params.get("real") === "1";
  const whoParam = params.get("who");
  const who: Who = whoParam === "winners" || whoParam === "losers" ? whoParam : "all";
  // the panel follows the selection until the reader picks a tab; a new selection takes it back
  const selectionKey = fund ? `fund ${fund}` : company ? `company ${company}` : "";
  const [chosenTab, setChosenTab] = useState<{ tab: Tab; key: string } | null>(null);
  const tab: Tab = chosenTab && chosenTab.key === selectionKey ? chosenTab.tab : selectionKey ? "selected" : "quarter";
  const setTab = (next: Tab) => setChosenTab({ tab: next, key: selectionKey });
  const [panelOpen, setPanelOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [homeSignal, setHomeSignal] = useState(0);
  const [aboveSignal, setAboveSignal] = useState(0);
  // the game view: the hall fills the screen, the site's header out of sight; Esc goes back to the page
  const [game, setGame] = useState(false);
  const hall = useRef<HTMLDivElement>(null);
  const enterGame = () => {
    setGame(true);
    hall.current?.requestFullscreen?.().catch(() => undefined);
  };
  const leaveGame = useCallback(() => {
    setGame(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!game) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leaveGame();
    };
    // the browser leaves full screen on Esc by itself; the game view follows
    const onScreen = () => {
      if (!document.fullscreenElement) setGame(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onScreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onScreen);
    };
  }, [game, leaveGame]);

  const fundFile = useFlowsFund(flowsOpen ? fund : null);
  const companyFile = useFlowsCompany(flowsOpen ? company : null);

  // the hall runs edge to edge: the stylesheet needs the width of the window without its scrollbar
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".desk-root");
    if (!root) return;
    const apply = () => root.style.setProperty("--desk-vw", `${document.documentElement.clientWidth}px`);
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--desk-vw");
    };
  }, []);

  // playing walks through the quarters and rests at the last
  const flowQuarters = overview.data?.quarters;
  const position = flowQuarters && row ? flowQuarters.findIndex((quarter) => quarter.quarter === row.quarter) : -1;
  const atEnd = !flowQuarters || position >= flowQuarters.length - 1;
  const running = playing && !atEnd;
  useEffect(() => {
    if (!running || !flowQuarters) return;
    const timer = window.setTimeout(() => set({ q: flowQuarters[position + 1].quarter }), 2600);
    return () => window.clearTimeout(timer);
  }, [running, flowQuarters, position, set]);

  const nav = useMemo<FlowNav>(
    () => ({
      fund: (cik) => set({ fund: cik, company: null }),
      company: (cik) => set({ company: cik, fund: null }),
      sector: (name) => set({ sector: name, fund: null, company: null }),
    }),
    [set],
  );

  const selection = useMemo<StageSelection>(() => {
    if (!row) return { kind: null, id: null, threads: [] };
    if (fund) {
      const moves = fundFile.data?.cik === fund ? fundFile.data.moves.find((entry) => entry.quarter === row.quarter) : undefined;
      return { kind: "fund", id: fund, threads: moves ? [...moves.buys, ...moves.sells].map((move) => ({ id: move.cik, usd: move.usd })) : [] };
    }
    if (company) {
      const trades = companyFile.data?.cik === company ? companyFile.data.quarters.find((entry) => entry.quarter === row.quarter) : undefined;
      return { kind: "company", id: company, threads: trades ? [...trades.buyers, ...trades.sellers].map((trade) => ({ id: trade.cik, usd: trade.usd })) : [] };
    }
    return { kind: null, id: null, threads: [] };
  }, [row, fund, company, fundFile.data, companyFile.data]);

  const onPick = useCallback(
    (target: StageTarget) => {
      if (target.kind === "company") nav.company(target.id);
      else if (target.kind === "fund") nav.fund(target.id);
      else if (target.kind === "sector") nav.sector(sector === target.name ? null : target.name);
      else if (target.kind === "outside") nav.sector(null);
    },
    [nav, sector],
  );

  if (!audienceReady) return <Shimmer height={420} />;
  if (!flowsOpen) return <Navigate to="/desk" replace />;
  if (overview.isLoading) return <Shimmer height={520} />;
  if (overview.error || !overview.data || !row) {
    return (
      <Notice title="The fund-flow files are not built yet">
        {overview.error?.message ?? "No complete pair of 13F quarters is available."} They are built on the home machine by scripts/build-fund-books.mts and scripts/build-fund-flows.mts.
      </Notice>
    );
  }
  const data = overview.data;
  const deflator = real ? deflatorSince(data, row) : 1;
  const standing = standingOf(row, who);
  const selectedName = fund ? data.funds.find((entry) => entry.cik === fund)?.name : company ? data.companies.find((entry) => entry.cik === company)?.ticker : null;

  const viewSwitch = (
    <Segmented<View>
      label="View"
      value={view}
      onChange={(next) => set({ view: next === "reading" ? "reading" : null })}
      options={[{ value: "library", label: "Library" }, { value: "reading", label: "Reading view" }]}
    />
  );
  const modeSwitch = (
    <Segmented<Mode>
      label="What the colour shows"
      value={mode}
      onChange={(next) => set({ show: next === "flow" ? null : next })}
      options={[{ value: "flow", label: "Where it went" }, { value: "outcome", label: "What it earned" }, { value: "held", label: "What is held" }]}
    />
  );
  const inflation = (
    <label className="desk-check" style={{ fontSize: 12.5 }}>
      <input type="checkbox" checked={real} onChange={(event) => set({ real: event.target.checked ? "1" : null })} /> after inflation
    </label>
  );
  const timeline = <FlowTimeline quarters={data.quarters} selected={row.quarter} onSelect={(quarter) => { setPlaying(false); set({ q: quarter }); }} palette={palette} height={view === "library" ? 84 : 132} />;
  const playButton = (
    <button type="button" className="desk-icon-button" onClick={() => {
      if (running) return setPlaying(false);
      // from the last quarter, play starts over
      if (atEnd) set({ q: data.quarters[0].quarter });
      setPlaying(true);
    }} aria-label={running ? "Pause" : "Play through the quarters"} title={running ? "Pause" : "Play through the quarters"}>
      {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
    </button>
  );
  const panel: ReactNode = (
    <>
      <div className="desk-lib-tabs" role="tablist" aria-label="Panel">
        <button type="button" role="tab" aria-selected={tab === "quarter"} onClick={() => setTab("quarter")}>{quarterLabel(row.quarter)}</button>
        <button type="button" role="tab" aria-selected={tab === "find"} onClick={() => setTab("find")}>Find a player</button>
        {(fund || company) && (
          <button type="button" role="tab" aria-selected={tab === "selected"} onClick={() => setTab("selected")}>
            {selectedName ?? "Selected"}
            <span role="button" tabIndex={0} aria-label="Clear the selection" className="desk-lib-clear" onClick={(event) => { event.stopPropagation(); set({ fund: null, company: null }); }} onKeyDown={(event) => { if (event.key === "Enter") set({ fund: null, company: null }); }}>
              <X size={13} aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
      <div className="desk-lib-panel-body">
        {tab === "quarter" && <QuarterPanel overview={data} row={row} focus={sector} nav={nav} deflator={deflator} />}
        {tab === "find" && <CatalogPanel overview={data} nav={nav} />}
        {tab === "selected" && fund && <FundPanel cik={fund} quarter={row.quarter} latest={data.latestQuarter} nav={nav} palette={palette} />}
        {tab === "selected" && company && <CompanyPanel cik={company} quarter={row.quarter} nav={nav} palette={palette} />}
      </div>
    </>
  );
  const legend = <Legend mode={mode} real={real} />;
  const provenance = (
    <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>
      {data.books.filings.toLocaleString("en-US")} filed 13F reports of {data.funds.length} managers, {data.companies.length} companies, quarters {quarterLabel(data.firstQuarter)} to {quarterLabel(data.latestQuarter)}; prices to {data.latestPriceDate ? fmtDate(data.latestPriceDate) : "—"}.
      {data.openQuarter ? ` ${quarterLabel(data.openQuarter.quarter)} is still being filed (${data.openQuarter.funds} reports so far) and is not shown.` : ""}
    </p>
  );

  if (view === "library") {
    return (
      <>
        <div className="desk-lib" ref={hall} data-game={game ? "on" : undefined}>
          <Suspense fallback={<div className="desk-lib-stage"><Shimmer height={520} /></div>}>
            <Library3D overview={data} row={row} mode={mode} real={real} focus={sector} selection={selection} dark={theme.resolved === "dark"} palette={palette} homeSignal={homeSignal} aboveSignal={aboveSignal} inset={panelOpen ? 418 : 0} insetBottom={150} game={game} who={who} onPick={onPick} />
          </Suspense>
          {game && (
            <div className="desk-lib-keys" aria-hidden="true">
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>
              <span>drag to look</span>
              <span><kbd>R</kbd><kbd>F</kbd> up, down</span>
              <span><kbd>Shift</kbd> faster</span>
              <span><kbd>Esc</kbd> leave</span>
            </div>
          )}
          <div className="desk-lib-head">
            <h1>The library of capital</h1>
            <p>
              <strong>{quarterLabel(row.quarter)}</strong> · {row.funds} funds · bought <strong>{fmtCap(row.bought)}</strong> · sold <strong>{fmtCap(row.sold)}</strong>
            </p>
            {standing.bar !== null && standing.winners + standing.losers > 0 && (
              <div className="desk-lib-who">
                <Segmented<Who>
                  label="Who is in the hall"
                  value={who}
                  onChange={(next) => set({ who: next === "all" ? null : next })}
                  options={[{ value: "all", label: "All" }, { value: "winners", label: `Winners · ${standing.winners}` }, { value: "losers", label: `Losers · ${standing.losers}` }]}
                />
                <p className="desk-muted">
                  {who === "all"
                    ? `A winner's book did better this quarter than all tracked funds together (${fmtPct(standing.bar, 1)}), a loser's worse.`
                    : `${who === "winners" ? "Funds whose book did better" : "Funds whose book did worse"} this quarter than all tracked funds together (${fmtPct(standing.bar, 1)}); the others wait outside.`}
                </p>
              </div>
            )}
            {sector && (
              <button type="button" className="desk-badge accent" onClick={() => nav.sector(null)} style={{ cursor: "pointer", marginTop: 8 }}>
                {sector} <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="desk-lib-tools">
            {viewSwitch}
            {modeSwitch}
            {mode === "outcome" && inflation}
            <button type="button" className="desk-icon-button" onClick={() => { set({ sector: null, fund: null, company: null }); setHomeSignal((count) => count + 1); }} aria-label="Back to the entrance" title="Back to the entrance">
              <DoorOpen size={16} aria-hidden="true" />
            </button>
            <button type="button" className="desk-icon-button" onClick={() => setAboveSignal((count) => count + 1)} aria-label="View from above" title="View from above: the whole floor at once">
              <Eye size={16} aria-hidden="true" />
            </button>
            <button type="button" className="desk-icon-button" aria-pressed={game} onClick={() => (game ? leaveGame() : enterGame())} aria-label={game ? "Leave the game view" : "Game view: the hall on the whole screen"} title={game ? "Leave the game view (Esc)" : "Game view: the hall on the whole screen"}>
              {game ? <Minimize2 size={16} aria-hidden="true" /> : <Gamepad2 size={16} aria-hidden="true" />}
            </button>
            <button type="button" className="desk-icon-button" aria-pressed={helpOpen} onClick={() => setHelpOpen((open) => !open)} aria-label="How to read the hall" title="How to read the hall">
              <Info size={16} aria-hidden="true" />
            </button>
            <button type="button" className="desk-icon-button" onClick={() => setPanelOpen((open) => !open)} aria-label={panelOpen ? "Hide the panel" : "Show the panel"} title={panelOpen ? "Hide the panel" : "Show the panel"}>
              {panelOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
            </button>
          </div>
          {helpOpen && (
            <div className="desk-lib-help" role="note">
              <strong>How to read the hall</strong>
              <ul>
                <li>Each bookcase is a sector; each book a company. A thicker book: more of it is held by the funds.</li>
                <li>A book pulled out toward you was bought this quarter, a book pushed back was sold. The further, the more dollars.</li>
                <li>The people are the funds. Each stands at the bookcase where it bought most this quarter (or where it leans most), the largest funds tallest. A blue jacket bought more than it sold, a red jacket sold more. The index giants keep the library at the map table in the middle.</li>
                <li>A figure is a man or a woman when a public source names the firm's leader; a wooden mannequin otherwise. Clothes follow the holdings: suits for banks and industry, tech wear for technology, casual in between.</li>
                <li>The streams overhead are the estimated rotation, as wide as the dollars: red where money left, blue where it arrived. The entrance is everything outside these stocks.</li>
                <li>Select a person to see its money run to the books, or a book to see who traded it. Change the quarter and the people walk to their new places.</li>
                <li>All, Winners, Losers: a winner's book did better in the quarter than all tracked funds together, a loser's worse. The others walk out and wait outside until you switch back.</li>
                <li>Drag to look around, scroll or W A S D to walk, R and F to rise and fall. The game view fills the screen. The reading view has the same figures as charts and tables.</li>
              </ul>
            </div>
          )}
          {panelOpen && <aside className="desk-lib-panel" aria-label="Details">{panel}</aside>}
          <div className="desk-lib-foot" data-panel={panelOpen ? "open" : "closed"}>
            <div className="desk-lib-time">
              {playButton}
              <div style={{ flex: 1, minWidth: 0 }}>{timeline}</div>
            </div>
            {legend}
          </div>
        </div>
        <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
          {provenance}
          <DevNotes page="flows" />
        </div>
      </>
    );
  }

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <h1>Fund flows</h1>
          <p><Sentence parts={quarterSentence(row)} /></p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {canWalk ? viewSwitch : <span className="desk-muted" style={{ fontSize: 12.5 }}><Library size={14} aria-hidden="true" /> The library view needs WebGL, which this browser does not offer.</span>}
        </div>
      </div>
      <div className="desk-grid">
        <Card className="desk-span-12" title="Bought and sold, by quarter" subtitle="Blue above the line: dollars bought. Red below: dollars sold. Select a quarter." action={playButton}>
          {timeline}
        </Card>
        <Card className="desk-span-8" title={`Where the money went in ${quarterLabel(row.quarter)}`} subtitle="An estimate: each fund's sales are paired with its own purchases of the quarter; the rest came from, or left to, everything outside the covered stocks.">
          <RotationDiagram quarter={row} focus={sector} onFocus={(name) => nav.sector(name)} palette={palette} />
        </Card>
        <div className="desk-card desk-span-4" style={{ maxHeight: 640, overflow: "auto" }}>{panel}</div>
        <Card className="desk-span-12" title="Sectors through time" subtitle="Net flow of each quarter as a share of what the funds held in the sector.">
          <FlowTape quarters={data.quarters} selected={row.quarter} onSelect={(quarter, name) => set({ q: quarter, sector: name, fund: null, company: null })} palette={palette} />
        </Card>
        <Card className="desk-span-12" title="Every sector this quarter" subtitle={`${quarterLabel(row.quarter)}, ${row.funds} funds counted`}>
          <SectorTable row={row} onSector={(name) => nav.sector(name)} />
        </Card>
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
        {provenance}
        <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}><BookOpen size={13} aria-hidden="true" /> A 13F report is a list of holdings at a quarter end, public up to 45 days later. A flow here is the change between two such lists; nothing inside a quarter is seen.</p>
        <DevNotes page="flows" />
      </div>
    </div>
  );
}

function Legend({ mode, real }: { mode: Mode; real: boolean }) {
  return (
    <div className="desk-lib-legend">
      {mode === "held" ? (
        <span>gold: the value the tracked funds hold, brighter for more (log scale)</span>
      ) : (
        <>
          <span><span className="desk-flow-dot" data-way="in" aria-hidden="true" />{mode === "flow" ? "bought" : "gained since"}</span>
          <span><span className="desk-flow-dot" data-way="out" aria-hidden="true" />{mode === "flow" ? "sold" : "lost since"}</span>
          <span>{mode === "flow" ? "colour: net flow against the value held" : `colour: the stock's return since that quarter${real ? ", after inflation" : ""}`}</span>
        </>
      )}
      {mode !== "held" && <span>pulled out = bought · pushed back = sold</span>}
      <span>jacket: the fund's net flow</span>
      {mode !== "held" && <span>streams: estimated rotation, width = dollars</span>}
    </div>
  );
}

function SectorTable({ row, onSector }: { row: FlowQuarter; onSector: (name: string) => void }) {
  return (
    <div className="desk-table-wrap">
      <table className="desk-table">
        <thead>
          <tr>
            <th scope="col">Sector</th>
            <th scope="col" className="num">Bought</th>
            <th scope="col" className="num">Sold</th>
            <th scope="col" className="num">Net</th>
            <th scope="col" className="num">Held</th>
            <th scope="col" className="num">Net, share of held</th>
          </tr>
        </thead>
        <tbody>
          {row.sectors.filter((sector) => sector.sector !== "Other").map((sector) => (
            <tr key={sector.sector}>
              <th scope="row"><button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => onSector(sector.sector)}>{sector.sector}</button></th>
              <td className="num">{fmtCap(sector.bought)}</td>
              <td className="num">{fmtCap(sector.sold)}</td>
              <td className="num">{sector.net < 0 ? "−" : "+"}{fmtCap(Math.abs(sector.net))}</td>
              <td className="num">{fmtCap(sector.held)}</td>
              <td className="num">{sector.held > 0 ? `${((sector.net / sector.held) * 100).toFixed(2)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
