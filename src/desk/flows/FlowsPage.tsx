/**
 * Fund flows: what the tracked 13F filers bought and sold, quarter by quarter, where the money went and what it
 * earned. Two views of the same figures: the library (a hall to walk through) and the reading view (charts and
 * tables). Everything selected lives in the address, so a view can be linked.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Gamepad2, Info, Library, Minimize2, PanelRightClose, PanelRightOpen, Pause, Play, Route, X } from "lucide-react";
import type { FlowQuarter, FundFlowsOverview } from "@contracts/fund-flows";
import { Card, Notice, Segmented, Shimmer } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtDate, fmtPct } from "../format";
import { FlowTape, FlowTimeline, RotationDiagram } from "./charts";
import { deflatorSince, quarterLabel, quarterSentence, standingOf, useFlowsCompany, useFlowsFund, useFlowsOverview, type Who } from "./data";
import type { StageSelection, StageTarget } from "./hall/stage";
import type { HallRest } from "./Library3D";
import type { StreamPart } from "./hall/streams";
import { webglAvailable } from "./hall/webgl";
import { CatalogPanel, CompanyPanel, FundPanel, QuarterPanel, Sentence, type FlowNav } from "./panels";
import { quarterStory } from "./story";

const Library3D = lazy(() => import("./Library3D"));
const HEAD_KEY = "alpha.desk.flows.head";
const TOUR_KEY = "alpha.desk.flows.tour";

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
  const audience = params.get("audience") === "people" ? "people" : "funds";
  const whoParam = params.get("who");
  const who: Who = whoParam === "winners" || whoParam === "losers" ? whoParam : "all";
  // all the streams of money, only what was bought (going in, blue) or only what was sold (coming out, red)
  const streamsParam = params.get("streams");
  const streams: StreamPart = streamsParam === "bought" || streamsParam === "blue" ? "bought" : streamsParam === "sold" || streamsParam === "red" ? "sold" : "all";
  // the panel follows the selection until the reader picks a tab; a new selection takes it back
  const selectionKey = fund ? `fund ${fund}` : company ? `company ${company}` : "";
  const [chosenTab, setChosenTab] = useState<{ tab: Tab; key: string } | null>(null);
  const tab: Tab = chosenTab && chosenTab.key === selectionKey ? chosenTab.tab : selectionKey ? "selected" : "quarter";
  const setTab = (next: Tab) => setChosenTab({ tab: next, key: selectionKey });
  const [panelOpen, setPanelOpen] = useState(true);
  // the title panel over the hall folds to its title and the quarter's line; the choice is remembered on this browser
  const [headOpen, setHeadOpen] = useState(() => {
    try {
      return window.localStorage.getItem(HEAD_KEY) !== "folded";
    } catch {
      return true;
    }
  });
  const toggleHead = () => {
    const next = !headOpen;
    setHeadOpen(next);
    try {
      window.localStorage.setItem(HEAD_KEY, next ? "open" : "folded");
    } catch {
      // storage may be unavailable; the panel still folds for this visit
    }
  };
  const [helpOpen, setHelpOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  // where the hall rests while nothing is in focus; asking again (the tick) flies there from wherever the reader went
  const [rest, setRest] = useState<{ view: HallRest; tick: number }>({ view: "overview", tick: 0 });
  const restAt = useCallback((view: HallRest) => setRest((current) => ({ view, tick: current.tick + 1 })), []);
  // the guided walk through the quarter: open on the first visit, and wherever the reader left it after that
  const [tour, setTour] = useState<number | null>(() => {
    try {
      if (params.get("sector") || params.get("fund") || params.get("company")) return null;
      return window.localStorage.getItem(TOUR_KEY) === "closed" ? null : 0;
    } catch {
      return 0;
    }
  });
  const rememberTour = (open: boolean) => {
    try {
      window.localStorage.setItem(TOUR_KEY, open ? "open" : "closed");
    } catch {
      // storage may be unavailable; the walk still opens and closes for this visit
    }
  };
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

  const companyNames = useMemo(() => new Map((overview.data?.companies ?? []).map((entry) => [entry.cik, entry.name])), [overview.data]);
  const story = useMemo(() => (row ? quarterStory(row, companyNames) : []), [row, companyNames]);
  /** Takes the reader to a step of the walk: its view of the hall and what is selected there. */
  const showStep = useCallback(
    (index: number) => {
      const step = story[index];
      if (!step) return;
      setTour(index);
      if ("view" in step.go) {
        set({ sector: null, fund: null, company: null });
        restAt(step.go.view);
      } else if ("sector" in step.go) set({ sector: step.go.sector, fund: null, company: null });
      else set({ company: step.go.company, fund: null, sector: null });
    },
    [story, set, restAt],
  );

  const onPick = useCallback(
    (target: StageTarget) => {
      if (target.kind === "company" || target.kind === "fund" || target.kind === "sector" || target.kind === "outside") setTour(null);
      // a second click on the book or the person already chosen lets it go (the hall flies back to where the reader was)
      if (target.kind === "company") {
        if (target.id === company) set({ company: null });
        else nav.company(target.id);
      } else if (target.kind === "fund") {
        if (target.id === fund) set({ fund: null });
        else nav.fund(target.id);
      } else if (target.kind === "sector") nav.sector(sector === target.name ? null : target.name);
      else if (target.kind === "outside") nav.sector(null);
    },
    [nav, sector, company, fund, set],
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
            <Library3D overview={data} row={row} mode={mode} real={real} focus={sector} selection={selection} dark={theme.resolved === "dark"} palette={palette} rest={rest.view} restTick={rest.tick} inset={panelOpen ? 418 : 0} insetBottom={tour !== null && story[tour] ? 262 : 150} game={game} who={who} audience={audience} streams={mode === "held" ? "all" : streams} onPick={onPick} />
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
          <div className="desk-lib-head" data-open={headOpen ? "true" : "false"}>
            <div className="desk-lib-head-top">
              <h1>The library of capital</h1>
              <button type="button" className="desk-icon-button desk-lib-fold" aria-expanded={headOpen} onClick={toggleHead} aria-label={headOpen ? "Fold the title panel" : "Open the title panel"} title={headOpen ? "Fold" : "Open"}>
                {headOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
              </button>
            </div>
            <p>
              <strong>{quarterLabel(row.quarter)}</strong> · {row.funds} funds · bought <strong>{fmtCap(row.bought)}</strong> · sold <strong>{fmtCap(row.sold)}</strong>
            </p>
            {headOpen && (
              <div className="desk-lib-switches">
                <Segmented<"funds" | "people">
                  label="Who stands in the hall"
                  value={audience}
                  onChange={(next) => set({ audience: next === "people" ? "people" : null })}
                  options={[{ value: "funds", label: "Funds" }, { value: "people", label: "People" }]}
                />
                {standing.bar !== null && standing.winners + standing.losers > 0 && (
                  <Segmented<Who>
                    label="Who is in the hall"
                    value={who}
                    onChange={(next) => set({ who: next === "all" ? null : next })}
                    options={[{ value: "all", label: "All" }, { value: "winners", label: `Winners · ${standing.winners}` }, { value: "losers", label: `Losers · ${standing.losers}` }]}
                  />
                )}
                {mode !== "held" && (
                  <Segmented<StreamPart>
                    label="Which streams of money show"
                    value={streams}
                    onChange={(next) => set({ streams: next === "all" ? null : next })}
                    options={[{ value: "all", label: "All flows" }, { value: "bought", label: "Bought" }, { value: "sold", label: "Sold" }]}
                  />
                )}
              </div>
            )}
            {headOpen && standing.bar !== null && who !== "all" && (
              <p className="desk-lib-note">{who === "winners" ? "Books that did better" : "Books that did worse"} than all tracked funds together ({fmtPct(standing.bar, 1)}); the others wait outside.</p>
            )}
            {headOpen && mode !== "held" && streams !== "all" && (
              <p className="desk-lib-note">{streams === "bought" ? "Bought, in blue: the money going into the books it was spent on." : "Sold, in red: the money coming out of the books that were sold."}</p>
            )}
            {sector && (
              <button type="button" className="desk-badge accent" onClick={() => nav.sector(null)} style={{ cursor: "pointer", marginTop: 6 }}>
                {sector} <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="desk-lib-tools">
            {viewSwitch}
            {modeSwitch}
            {mode === "outcome" && inflation}
            <div className="desk-seg" role="group" aria-label="Views of the hall">
              <button type="button" aria-pressed={rest.view === "overview" && !sector && !fund && !company} onClick={() => { set({ sector: null, fund: null, company: null }); restAt("overview"); }} title="Back to the opening view, with nothing selected">Overview</button>
              <button type="button" aria-pressed={rest.view === "above" && !sector && !fund && !company} onClick={() => { set({ sector: null, fund: null, company: null }); restAt("above"); }} title="Straight down on the whole floor">From above</button>
              <button type="button" aria-pressed={tour !== null} onClick={() => { if (tour === null) { rememberTour(true); showStep(0); } else { rememberTour(false); setTour(null); } }} title="A short walk through the quarter, one view at a time">
                <Route size={14} aria-hidden="true" style={{ marginRight: 5, verticalAlign: "-2px" }} />Walk me through
              </button>
            </div>
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
                <li><b>Bookcases and books.</b> A bookcase is a sector, a book a company. A book pulled out was bought this quarter, a book pushed back was sold; the further it moved, the more dollars.</li>
                <li><b>Ribbons overhead.</b> Money that moved between two sectors, as wide as the dollars: red at the end where it was sold, blue where it was bought. It is an estimate: each fund's sales are paired with its own purchases.</li>
                <li><b>The doorway.</b> Money that came in from outside the covered stocks, and money that left.</li>
                <li><b>People.</b> The funds, each at the bookcase where it bought most; the largest are the tallest. A blue jacket bought more than it sold, a red one sold more. The index funds keep the library at the map table.</li>
                <li><b>Selecting.</b> Click a book to see who traded it, a person to follow its money to the shelves; click again to let go. The boards over the bookcases show what came in and went out.</li>
                <li><b>Moving.</b> Drag to turn the hall, scroll to move in and out. Overview takes you back to the start; Walk me through shows the quarter in six views. The game view is for walking with W A S D.</li>
              </ul>
            </div>
          )}
          {tour !== null && story[tour] && (
            <section className="desk-lib-story" aria-label="A walk through the quarter" data-panel={panelOpen ? "open" : "closed"}>
              <div className="desk-lib-story-text">
                <div className="desk-lib-story-top">
                  <span className="desk-lib-story-count">{tour + 1} of {story.length}</span>
                  <h2>{story[tour].title}</h2>
                </div>
                <p>{story[tour].text}</p>
                <p className="desk-lib-story-hint">{story[tour].hint}</p>
              </div>
              <div className="desk-lib-story-nav">
                <button type="button" className="desk-button" disabled={tour === 0} onClick={() => showStep(tour - 1)} aria-label="Previous view">
                  <ChevronLeft size={14} aria-hidden="true" /> Back
                </button>
                {tour < story.length - 1 ? (
                  <button type="button" className="desk-button primary" onClick={() => showStep(tour + 1)} title={story[tour + 1].title}>
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" className="desk-button primary" onClick={() => { rememberTour(false); setTour(null); set({ sector: null, fund: null, company: null }); restAt("overview"); }}>
                    Explore freely
                  </button>
                )}
                <button type="button" className="desk-icon-button" onClick={() => { rememberTour(false); setTour(null); }} aria-label="Close the walk and explore freely" title="Close and explore freely">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
          {panelOpen &&<aside className="desk-lib-panel" aria-label="Details">{panel}</aside>}
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
