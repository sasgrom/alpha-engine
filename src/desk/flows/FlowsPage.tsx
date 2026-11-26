/**
 * Fund flows: what the tracked 13F filers bought and sold, quarter by quarter, where the money went and what it
 * earned. Two views of the same figures: the library (a hall to walk through) and the reading view (charts and
 * tables). Everything selected lives in the address, so a view can be linked.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { BookOpen, ChevronLeft, ChevronRight, Info, Library, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Pause, Play, Route, SlidersHorizontal, X } from "lucide-react";
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
import type { MapPick } from "./map/MoneyMap";

const Library3D = lazy(() => import("./Library3D"));
const MapView = lazy(() => import("./map/MapView"));
const TOUR_KEY = "alpha.desk.flows.tour";

// the money map is the main view since 2026-11-26 (owner: "create new look per your recommendations"); the 3D library
// stays as it was ("leave 3d as it is done, let it survive for now")
type View = "map" | "library" | "reading";
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
  const viewParam = params.get("view");
  const view: View = viewParam === "reading" ? "reading" : viewParam === "library" && canWalk ? "library" : "map";
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
  // The details panel opens with a selection (a fund or a company: who traded what) and keeps the hall to itself
  // otherwise; the reader can open or close it by hand, and a new selection takes it back.
  const [panelChoice, setPanelChoice] = useState<{ open: boolean; key: string } | null>(null);
  const panelOpen = panelChoice && panelChoice.key === selectionKey ? panelChoice.open : Boolean(selectionKey);
  const togglePanel = () => setPanelChoice({ open: !panelOpen, key: selectionKey });
  const [helpOpen, setHelpOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  // the popovers under the bar close on a click elsewhere and on Esc
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!helpOpen && !displayOpen) return;
    const onDown = (event: PointerEvent) => {
      if (controls.current && !controls.current.contains(event.target as Node)) {
        setHelpOpen(false);
        setDisplayOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpOpen(false);
      setDisplayOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [helpOpen, displayOpen]);
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
  // full screen: the hall fills the screen, the site's header out of sight, and the keys walk it wherever the focus
  // is; Esc goes back to the page
  const [full, setFull] = useState(false);
  const hall = useRef<HTMLDivElement>(null);
  const enterFull = () => {
    setFull(true);
    hall.current?.requestFullscreen?.().catch(() => undefined);
  };
  const leaveFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leaveFull();
    };
    // the browser leaves full screen on Esc by itself; the page follows
    const onScreen = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onScreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onScreen);
    };
  }, [full, leaveFull]);

  const fundFile = useFlowsFund(flowsOpen ? fund : null);
  const companyFile = useFlowsCompany(flowsOpen ? company : null);

  // the hall runs edge to edge and fills the window below the header and any banners (an operations alert or the
  // view-as line would otherwise push its bottom out of sight): the stylesheet needs the width of the window without
  // its scrollbar and the hall's own top on the page
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".desk-root");
    if (!root) return;
    const apply = () => {
      root.style.setProperty("--desk-vw", `${document.documentElement.clientWidth}px`);
      const hall = document.querySelector<HTMLElement>(".desk-lib, .desk-map");
      if (hall) root.style.setProperty("--desk-lib-top", `${Math.max(0, Math.round(hall.getBoundingClientRect().top + window.scrollY))}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    // banners come and go after the page opens (alerts load later): follow the page's size
    // (a banner above the hall makes the whole page taller, so the page root is watched)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(root);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
      root.style.removeProperty("--desk-vw");
      root.style.removeProperty("--desk-lib-top");
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
      onChange={(next) => set({ view: next === "map" ? null : next })}
      options={[{ value: "map", label: "Map" }, ...(canWalk ? [{ value: "library" as View, label: "3D library" }] : []), { value: "reading", label: "Reading view" }]}
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
  const timeline = <FlowTimeline quarters={data.quarters} selected={row.quarter} onSelect={(quarter) => { setPlaying(false); set({ q: quarter }); }} palette={palette} height={view === "reading" ? 132 : view === "map" ? 52 : 64} />;
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

  if (view === "map") {
    const onMapPick = (pick: MapPick) => {
      setTour(null);
      if (pick.kind === "company") set({ company: pick.id === company ? null : pick.id, fund: null });
      else if (pick.kind === "fund") set({ fund: pick.id === fund ? null : pick.id, company: null });
      else if (pick.kind === "sector") set({ sector: pick.name === sector ? null : pick.name, fund: null, company: null });
      else set({ fund: null, company: null });
    };
    const bar = (
      <>
        <div>
          <h1>Money map</h1>
          <p>
            <strong>{quarterLabel(row.quarter)}</strong> · {row.funds} funds · bought <strong>{fmtCap(row.bought)}</strong> · sold <strong>{fmtCap(row.sold)}</strong>
            {sector ? <> · <button type="button" className="desk-lib-chip" onClick={() => nav.sector(null)} aria-label={`Clear: ${sector}`}>{sector} <X size={12} aria-hidden="true" /></button></> : null}
          </p>
        </div>
        <div className="desk-map-bar-controls">
          {modeSwitch}
          {mode === "outcome" && inflation}
          {viewSwitch}
          <button type="button" className="desk-icon-button" aria-pressed={panelOpen} onClick={togglePanel} aria-label={panelOpen ? "Hide the details" : "Show the details"} title={panelOpen ? "Hide the details" : "Details of the quarter and of what is selected"}>
            {panelOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
          </button>
        </div>
      </>
    );
    const foot = (
      <>
        <div className="desk-lib-time">
          {playButton}
          <div style={{ flex: 1, minWidth: 0 }}>{timeline}</div>
        </div>
        <MapLegend mode={mode} real={real} />
      </>
    );
    return (
      <>
        <Suspense fallback={<Shimmer height={520} />}>
          <MapView
            data={data} row={row} mode={mode} deflator={deflator} palette={palette} dark={theme.resolved === "dark"}
            focus={sector} fund={fund} company={company}
            fundFile={fundFile.data ?? undefined} companyFile={companyFile.data ?? undefined}
            onPick={onMapPick} bar={bar} foot={foot} panel={panelOpen ? panel : null}
          />
        </Suspense>
        <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
          {provenance}
          <DevNotes page="flows" />
        </div>
      </>
    );
  }

  if (view === "library") {
    // what the reader has narrowed the hall to, each with a way back
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (sector) chips.push({ key: "sector", label: sector, clear: () => nav.sector(null) });
    if (audience === "people") chips.push({ key: "audience", label: "Famous faces", clear: () => set({ audience: null }) });
    if (who !== "all" && standing.bar !== null) chips.push({ key: "who", label: who === "winners" ? "Winners only" : "Losers only", clear: () => set({ who: null }) });
    if (mode !== "held" && streams !== "all") chips.push({ key: "streams", label: streams === "bought" ? "Bought ribbons only" : "Sold ribbons only", clear: () => set({ streams: null }) });
    if (mode === "outcome" && real) chips.push({ key: "real", label: "After inflation", clear: () => set({ real: null }) });
    const atRest = !sector && !fund && !company;
    return (
      <>
        <div className="desk-lib" ref={hall} data-full={full ? "on" : undefined}>
          <Suspense fallback={<div className="desk-lib-stage"><Shimmer height={520} /></div>}>
            <Library3D overview={data} row={row} mode={mode} real={real} focus={sector} selection={selection} dark={theme.resolved === "dark"} palette={palette} rest={rest.view} restTick={rest.tick} inset={panelOpen ? 412 : 0} insetBottom={tour !== null && story[tour] ? 210 : 110} game={full} who={who} audience={audience} streams={mode === "held" ? "all" : streams} onPick={onPick} />
          </Suspense>
          {full && <div className="desk-lib-keys" aria-hidden="true">Drag to turn · scroll to move in · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · <kbd>Esc</kbd> to leave</div>}
          <header className="desk-lib-bar">
            <div className="desk-lib-title">
              <h1>The library of capital</h1>
              <p>
                <strong>{quarterLabel(row.quarter)}</strong> · {row.funds} funds · bought <strong>{fmtCap(row.bought)}</strong> · sold <strong>{fmtCap(row.sold)}</strong>
              </p>
              {chips.length > 0 && (
                <div className="desk-lib-chips">
                  {chips.map((chip) => (
                    <button key={chip.key} type="button" className="desk-lib-chip" onClick={chip.clear} aria-label={`Clear: ${chip.label}`} title="Clear">
                      {chip.label} <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="desk-lib-controls" ref={controls}>
              {/* who stands in the hall: on the bar, one click away (owner, 2026-11-26: hidden in the popover it was missed) */}
              <div className="desk-seg" role="group" aria-label="Who stands in the hall">
                <button type="button" aria-pressed={audience !== "people"} onClick={() => set({ audience: null })} title="The funds, as people">Funds</button>
                <button type="button" aria-pressed={audience === "people"} onClick={() => set({ audience: "people" })} title="The famous investors behind them">Famous faces</button>
              </div>
              {modeSwitch}
              <div className="desk-seg" role="group" aria-label="Views of the hall">
                <button type="button" aria-pressed={rest.view === "overview" && atRest && tour === null} onClick={() => { set({ sector: null, fund: null, company: null }); restAt("overview"); }} title="Back to the opening view, with nothing selected">Overview</button>
                <button type="button" aria-pressed={rest.view === "above" && atRest && tour === null} onClick={() => { set({ sector: null, fund: null, company: null }); restAt("above"); }} title="Straight down on the whole floor">From above</button>
                <button type="button" aria-pressed={tour !== null} onClick={() => { if (tour === null) { rememberTour(true); showStep(0); } else { rememberTour(false); setTour(null); } }} title="A short walk through the quarter, one view at a time">
                  <Route size={14} aria-hidden="true" style={{ marginRight: 5, verticalAlign: "-2px" }} />Walk me through
                </button>
              </div>
              <div className="desk-seg" role="group" aria-label="The other views of these figures">
                <button type="button" onClick={() => set({ view: null })} title="The money map: the same figures flat, fast and zoomable">Money map</button>
                <button type="button" onClick={() => set({ view: "reading" })} title="The same figures as charts and tables">
                  <BookOpen size={14} aria-hidden="true" style={{ marginRight: 5, verticalAlign: "-2px" }} />Reading view
                </button>
              </div>
              <div className="desk-lib-icons">
                <button type="button" className="desk-icon-button" aria-pressed={displayOpen} aria-expanded={displayOpen} onClick={() => { setHelpOpen(false); setDisplayOpen((open) => !open); }} aria-label="What the hall shows" title="What the hall shows: who stands in it, which ribbons">
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
                <button type="button" className="desk-icon-button" aria-pressed={helpOpen} aria-expanded={helpOpen} onClick={() => { setDisplayOpen(false); setHelpOpen((open) => !open); }} aria-label="How to read the hall" title="How to read the hall">
                  <Info size={16} aria-hidden="true" />
                </button>
                <button type="button" className="desk-icon-button" aria-pressed={panelOpen} onClick={togglePanel} aria-label={panelOpen ? "Hide the details" : "Show the details"} title={panelOpen ? "Hide the details" : "Details of the quarter and of what is selected"}>
                  {panelOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
                </button>
                <button type="button" className="desk-icon-button" aria-pressed={full} onClick={() => (full ? leaveFull() : enterFull())} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen"}>
                  {full ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                </button>
              </div>
              {displayOpen && (
                <div className="desk-lib-pop" role="dialog" aria-label="What the hall shows">
                  <strong>What the hall shows</strong>
                  {standing.bar !== null && standing.winners + standing.losers > 0 && (
                    <div className="desk-lib-pop-row">
                      <span>Whose books</span>
                      <Segmented<Who>
                        label="Whose books"
                        value={who}
                        onChange={(next) => set({ who: next === "all" ? null : next })}
                        options={[{ value: "all", label: "All" }, { value: "winners", label: `Winners · ${standing.winners}` }, { value: "losers", label: `Losers · ${standing.losers}` }]}
                      />
                    </div>
                  )}
                  {standing.bar !== null && who !== "all" && (
                    <p className="desk-lib-note">{who === "winners" ? "Funds whose books did better" : "Funds whose books did worse"} than all tracked funds together ({fmtPct(standing.bar, 1)}); the others wait outside.</p>
                  )}
                  {mode !== "held" && (
                    <div className="desk-lib-pop-row">
                      <span>Ribbons</span>
                      <Segmented<StreamPart>
                        label="Which streams of money show"
                        value={streams}
                        onChange={(next) => set({ streams: next === "all" ? null : next })}
                        options={[{ value: "all", label: "All flows" }, { value: "bought", label: "Bought" }, { value: "sold", label: "Sold" }]}
                      />
                    </div>
                  )}
                  {mode !== "held" && streams !== "all" && (
                    <p className="desk-lib-note">{streams === "bought" ? "Bought, in blue: the money going into the books it was spent on." : "Sold, in red: the money coming out of the books that were sold."}</p>
                  )}
                  {mode === "outcome" && <div className="desk-lib-pop-row">{inflation}</div>}
                </div>
              )}
              {helpOpen && (
                <div className="desk-lib-pop desk-lib-help" role="note">
                  <strong>How to read the hall</strong>
                  <ul>
                    <li><b>Bookcases and books.</b> A bookcase is a sector, a book a company. A book pulled out was bought this quarter, a book pushed back was sold; the further it moved, the more dollars. Its colour is the net flow against the value the funds hold (in "What it earned", the stock's return since).</li>
                    <li><b>Ribbons overhead.</b> Money that moved between two sectors, as wide as the dollars: red where it was sold, blue where it was bought, with glints running the way it went. It is an estimate: each fund's sales are paired with its own purchases.</li>
                    <li><b>The doorway.</b> Money that came in from outside the covered stocks, and money that left.</li>
                    <li><b>People.</b> The funds, each at the bookcase where it bought most; the largest are the tallest. A blue jacket bought more than it sold, a red one sold more. The index funds keep the library at the map table.</li>
                    <li><b>Selecting.</b> Click a book to see who traded it, a person to follow its money to the shelves; click again to let go. The boards over the bookcases show what came in and went out.</li>
                    <li><b>Moving.</b> Drag to turn the hall, scroll to move in and out. Overview brings you back; Walk me through shows the quarter in six views. After a click on the hall, W A S D walk and Q E turn.</li>
                  </ul>
                </div>
              )}
            </div>
          </header>
          {panelOpen && <aside className="desk-lib-panel" aria-label="Details">{panel}</aside>}
          <div className="desk-lib-bottom" data-panel={panelOpen ? "open" : "closed"}>
            {tour !== null && story[tour] && (
              <section className="desk-lib-story" aria-label="A walk through the quarter">
                <div className="desk-lib-story-top">
                  <span className="desk-lib-story-count">{tour + 1} of {story.length}</span>
                  <h2>{story[tour].title}</h2>
                  <button type="button" className="desk-icon-button desk-lib-story-close" onClick={() => { rememberTour(false); setTour(null); }} aria-label="Close the walk and explore freely" title="Close and explore freely">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                <p>{story[tour].text}</p>
                <p className="desk-lib-story-hint">{story[tour].hint}</p>
                <div className="desk-lib-story-nav">
                  <div className="desk-lib-story-dots" aria-hidden="true">
                    {story.map((step, index) => <span key={step.title} data-on={index === tour ? "true" : undefined} />)}
                  </div>
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
                </div>
              </section>
            )}
            <div className="desk-lib-foot">
              <div className="desk-lib-time">
                {playButton}
                <div style={{ flex: 1, minWidth: 0 }}>{timeline}</div>
              </div>
              {legend}
            </div>
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
          {viewSwitch}
          {!canWalk && <span className="desk-muted" style={{ fontSize: 12.5 }}><Library size={14} aria-hidden="true" /> The 3D library needs WebGL, which this browser does not offer.</span>}
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

/** What the map's colours say, in one line. */
function MapLegend({ mode, real }: { mode: Mode; real: boolean }) {
  return (
    <div className="desk-lib-legend">
      {mode === "held" ? (
        <span>tiles: the value the tracked funds hold, darker gold for more · tile size: value held in the latest quarter</span>
      ) : (
        <>
          <span><span className="desk-flow-dot" data-way="in" aria-hidden="true" />{mode === "flow" ? "bought, net" : "gained since"}</span>
          <span><span className="desk-flow-dot" data-way="out" aria-hidden="true" />{mode === "flow" ? "sold, net" : "lost since"}</span>
          <span className="desk-lib-legend-note">{mode === "flow" ? "streams: money moved between sectors (an estimate), red where it left, blue where it arrived · pins: people, blue when their book beat all funds" : `tiles: the stock's return since that quarter${real ? ", after inflation" : ""}`}</span>
        </>
      )}
    </div>
  );
}

/** What the colours say, in one line; "How to read the hall" has the rest. */
function Legend({ mode, real }: { mode: Mode; real: boolean }) {
  return (
    <div className="desk-lib-legend">
      {mode === "held" ? (
        <span>gold: the value the tracked funds hold, brighter for more (log scale)</span>
      ) : (
        <>
          <span><span className="desk-flow-dot" data-way="in" aria-hidden="true" />{mode === "flow" ? "bought" : "gained since"}</span>
          <span><span className="desk-flow-dot" data-way="out" aria-hidden="true" />{mode === "flow" ? "sold" : "lost since"}</span>
          <span className="desk-lib-legend-note">{mode === "flow" ? "ribbons: money moved between sectors, as wide as the dollars" : `books: the stock's return since that quarter${real ? ", after inflation" : ""}`}</span>
        </>
      )}
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
