/**
 * React frame of the hall: builds the stage once per data set and theme, hands it the selected quarter, where every
 * fund stands and how it is drawn, and the selection, and shows what the pointer rests on. All drawing is in
 * hall/stage.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_OUTSIDE, FUND_CATEGORY_LABEL, type FlowQuarter, type FundFlowsOverview } from "@contracts/fund-flows";
import type { ChartPalette } from "../charts/color";
import { fmtCap, fmtPct } from "../format";
import { deflatorSince, hallSectorOrder, quarterLabel, signedCap, standingOf, type Who } from "./data";
import { characterFor, firstFiledOf } from "./hall/character";
import { FAMOUS_BY_CIK, NOT_COLLECTED } from "./hall/famous";
import { bodyFor, decodePlaces, FIGURE_SIZE, figureScale, leaderAt, lookFor, outfitFor } from "./hall/figures";
import { topLists } from "./hall/lists";
import { HallStage, type StageData, type StageFigure, type StageSelection, type StageTarget } from "./hall/stage";
import type { StreamPart } from "./hall/streams";

export interface LibraryProps {
  overview: FundFlowsOverview;
  row: FlowQuarter;
  mode: "flow" | "outcome" | "held";
  /** Restate "what it earned" after inflation. */
  real: boolean;
  focus: string | null;
  selection: StageSelection;
  dark: boolean;
  palette: ChartPalette;
  /** Changes when the reader asks to be taken back to the entrance, or up to look over the whole hall. */
  homeSignal: number;
  aboveSignal: number;
  /** Pixels of the hall covered by the panel on the right (0 when it is closed) and by the strip at the bottom. */
  inset: number;
  insetBottom: number;
  /** Full-screen game view: the keys walk the hall wherever the focus is (except in a text field). */
  game: boolean;
  /** Who is in the hall: every fund, or only the quarter's winners or losers. */
  who: Who;
  /** The funds as themselves, or as the famous faces behind them (and placeholders for those not collected). */
  audience: "funds" | "people";
  /** Every stream of money whole, or only the half of each where the money arrived (blue) or where it left (red). */
  streams: StreamPart;
  onPick: (target: StageTarget) => void;
}

export default function Library3D({ overview, row, mode, real, focus, selection, dark, palette, homeSignal, aboveSignal, inset, insetBottom, game, who, audience, streams, onPick }: LibraryProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HallStage | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [hover, setHover] = useState<{ target: StageTarget; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(0);
  const [loading, setLoading] = useState<"loading" | "ready" | string>("loading");

  const company = useMemo(() => new Map(overview.companies.map((entry) => [entry.cik, entry])), [overview]);
  const fund = useMemo(() => new Map(overview.funds.map((entry) => [entry.cik, entry])), [overview]);
  const sectorOrder = useMemo(() => hallSectorOrder(overview), [overview]);
  const places = useMemo(() => decodePlaces(row, overview.sectorNames ?? []), [row, overview]);
  const firstFiled = useMemo(() => new Map(overview.funds.map((entry) => [entry.cik, entry.firstFiled ?? null])), [overview]);
  const figures = useMemo(() => {
    const result = new Map<number, StageFigure>();
    for (const [cik, place] of places) {
      const entry = fund.get(cik);
      const staff = entry?.category === "index";
      const face = audience === "people" ? FAMOUS_BY_CIK.get(cik) : undefined;
      const leader = face ? { name: face.name, gender: face.gender } : leaderAt(cik, row.quarter);
      // the library's staff wear suits; everyone else dresses for where the money stands
      const outfit = staff ? "suit" : outfitFor(place.home);
      const body = bodyFor(leader?.gender, outfit, cik);
      // famous faces are seen from across the hall: never smaller than 0.85 of a person
      const scale = face ? Math.max(0.85, figureScale(entry?.tracked ?? 0)) : figureScale(entry?.tracked ?? 0);
      // age from the firm's history, build from its size, what it carries from both
      const character = characterFor(cik, firstFiledOf(cik, firstFiled), (scale - FIGURE_SIZE.smallest) / (FIGURE_SIZE.largest - FIGURE_SIZE.smallest), outfit === "tech", staff);
      result.set(cik, { body, scale, staff, leader: leader?.name ?? null, look: lookFor(cik), girth: character.girth, hair: character.hair, carry: character.carry, pace: character.pace });
    }
    return result;
  }, [places, fund, row.quarter, audience, firstFiled]);

  // in the "people" audience only the famous faces stay, under their own names
  const names = useMemo(() => (audience === "people" ? new Map([...places.keys()].flatMap((cik) => (FAMOUS_BY_CIK.has(cik) ? [[cik, FAMOUS_BY_CIK.get(cik)!.name] as [number, string]] : []))) : null), [audience, places]);
  const placeholders = useMemo(() => (audience === "people" ? NOT_COLLECTED.map((person, index) => ({ id: -(index + 1), name: person.name, note: person.note })) : []), [audience]);
  const keep = useMemo(() => {
    const standing = standingOf(row, who).keep;
    if (!names) return standing;
    return new Set([...names.keys()].filter((cik) => !standing || standing.has(cik)));
  }, [row, who, names]);
  const lists = useMemo(() => topLists(overview, row, mode, who), [overview, row, mode, who]);
  const data = useMemo<StageData>(
    () => ({
      company: new Map(row.companyFlows.map(([cik, net, held, since]) => [cik, { net, held, since }])),
      fund: new Map(row.fundFlows.map(([cik, bought, sold]) => [cik, { bought, sold }])),
      sectors: new Map(row.sectors.map((sector) => [sector.sector, sector])),
      links: row.rotation,
      mode,
      deflator: real ? deflatorSince(overview, row) : 1,
      focus,
      places,
      figures,
      keep,
      quarter: quarterLabel(row.quarter),
      lists,
      names,
      placeholders,
    }),
    [overview, row, mode, real, focus, places, figures, keep, lists, names, placeholders],
  );

  useEffect(() => {
    if (!host.current) return;
    setLoading("loading");
    const built = new HallStage(
      host.current,
      overview.companies.map((entry) => ({ cik: entry.cik, ticker: entry.ticker, name: entry.name, sector: entry.sector, held: entry.held, hq: entry.hq })),
      overview.funds.map((entry) => ({ cik: entry.cik, name: entry.name, category: entry.category, tracked: entry.tracked })),
      sectorOrder,
      dark,
      palette,
      {
        onHover: (target, x, y) => setHover(target ? { target, x, y } : null),
        onPick: (target) => target && pick.current(target),
        onReady: (error) => setLoading(error ?? "ready"),
      },
    );
    stage.current = built;
    setReady((count) => count + 1);
    return () => {
      stage.current = null;
      built.dispose();
    };
  }, [overview, sectorOrder, dark, palette]);

  useEffect(() => {
    stage.current?.setData(data);
  }, [data, ready]);

  useEffect(() => {
    stage.current?.setSelection(selection);
  }, [selection, ready]);

  useEffect(() => {
    if (selection.kind === null) stage.current?.flyToSector(focus);
    // a selection has its own vantage point; the sector only matters without one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  useEffect(() => {
    if (homeSignal > 0) stage.current?.flyHome();
  }, [homeSignal]);

  useEffect(() => {
    if (aboveSignal > 0) stage.current?.flyAbove();
  }, [aboveSignal]);

  useEffect(() => {
    stage.current?.setInset(inset, insetBottom);
  }, [inset, insetBottom, ready]);

  useEffect(() => {
    stage.current?.setGame(game);
  }, [game, ready]);

  useEffect(() => {
    stage.current?.setStreamPart(streams);
  }, [streams, ready]);

  const tip = hover && tooltip(hover.target, { overview, row, company, fund, data, real });
  return (
    <div className="desk-lib-stage">
      {/* the stage puts its canvas and labels in here; nothing React renders shares this element */}
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {loading !== "ready" && (
        <div className="desk-lib-loading" role="status">
          {loading === "loading" ? "Opening the hall…" : `The hall could not be opened: ${loading}. The reading view has the same figures.`}
        </div>
      )}
      {tip && hover && (
        <div className="desk-tooltip desk-lib-tip" style={{ left: Math.min(hover.x + 16, (host.current?.clientWidth ?? 600) - 290), top: Math.max(8, hover.y - 12) }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((line) => (
            <div key={line[0]} className="row"><span>{line[0]}</span><span>{line[1]}</span></div>
          ))}
          <div className="desk-muted">{(hover.target.kind === "company" || hover.target.kind === "fund") && hover.target.kind === selection.kind && hover.target.id === selection.id ? "Click again to let it go and go back" : tip.hint}</div>
        </div>
      )}
    </div>
  );
}

function tooltip(
  target: StageTarget,
  context: { overview: FundFlowsOverview; row: FlowQuarter; company: Map<number, FundFlowsOverview["companies"][number]>; fund: Map<number, FundFlowsOverview["funds"][number]>; data: StageData; real: boolean },
): { title: string; lines: [string, string][]; hint: string } {
  const { row, data } = context;
  const quarter = quarterLabel(row.quarter);
  if (target.kind === "company") {
    const entry = context.company.get(target.id);
    const flow = data.company.get(target.id);
    const since = flow?.since ?? null;
    return {
      title: entry ? `${entry.ticker} · ${entry.name}` : `Company ${target.id}`,
      lines: [
        [`Net flow, ${quarter}`, flow ? signedCap(flow.net) : "—"],
        ["Held by the counted funds", flow ? fmtCap(flow.held) : "—"],
        [context.real ? "Stock since, after inflation" : "Stock since", since === null ? "—" : fmtPct((1 + since) / data.deflator - 1, 0)],
      ],
      hint: "Select to see who bought and who sold",
    };
  }
  if (target.kind === "fund" && target.id < 0) {
    const placeholder = data.placeholders.find((item) => item.id === target.id);
    return { title: placeholder?.name ?? "Not collected", lines: [["Trades", placeholder?.note ?? "not collected"]], hint: "Waiting by the entrance until their trades are in the books" };
  }
  if (target.kind === "fund") {
    const entry = context.fund.get(target.id);
    const flow = data.fund.get(target.id);
    const figure = data.figures.get(target.id);
    const home = data.places.get(target.id)?.home;
    const lines: [string, string][] = flow ? [[`Bought, ${quarter}`, fmtCap(flow.bought)], ["Sold", fmtCap(flow.sold)], ["Net", signedCap(flow.bought - flow.sold)]] : [[quarter, "no counted report"]];
    if (entry) lines.push(["Kind", FUND_CATEGORY_LABEL[entry.category]]);
    if (figure?.staff) lines.push(["Stands", "with the library's staff at the map"]);
    else if (home) lines.push(["Stands at", home]);
    const face = data.names?.has(target.id) ? FAMOUS_BY_CIK.get(target.id) : undefined;
    if (face) lines.unshift(["", face.role]);
    else lines.push(["Led by", figure?.leader ?? "not on record here"]);
    if (figure?.carry) lines.push(["Carries", figure.carry === "bike" ? "a bicycle" : figure.carry === "scooter" ? "a scooter" : `a ${figure.carry}`]);
    return { title: face ? face.name : entry?.name ?? `Fund ${target.id}`, lines, hint: "Select to follow its money to the shelves" };
  }
  if (target.kind === "stream") {
    const name = (sector: string) => (sector === FLOW_OUTSIDE ? "Main Street and everything outside" : sector);
    return {
      title: `${name(target.from)} → ${name(target.to)}`,
      lines: [[`Moved, ${quarter}`, fmtCap(target.usd)]],
      hint: "An estimate: each fund's sales paired with its own purchases of the quarter",
    };
  }
  if (target.kind === "state") {
    let net = 0;
    let count = 0;
    const names: [string, number][] = [];
    for (const entry of context.overview.companies) {
      if (entry.hq !== target.code) continue;
      count++;
      const flow = data.company.get(entry.cik)?.net ?? 0;
      net += flow;
      names.push([entry.ticker, flow]);
    }
    names.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return {
      title: target.name,
      lines: [[`Net flow, ${quarter}`, count ? signedCap(net) : "—"], ["Companies headquartered here", String(count)], ...names.slice(0, 3).filter((item) => item[1] !== 0).map(([ticker, flow]) => [ticker, signedCap(flow)] as [string, string])],
      hint: "Headquarters as of today, from the companies' SEC records",
    };
  }
  if (target.kind === "sector") {
    const sector = data.sectors.get(target.name);
    return {
      title: target.name,
      lines: sector ? [[`Bought, ${quarter}`, fmtCap(sector.bought)], ["Sold", fmtCap(sector.sold)], ["Net", signedCap(sector.net)]] : [],
      hint: "Select to stand in front of this bookcase",
    };
  }
  const arriving = row.rotation.filter((link) => link.from === FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0);
  const leaving = row.rotation.filter((link) => link.to === FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0);
  return {
    title: "Outside the covered stocks",
    lines: [["New money that came in", fmtCap(arriving)], ["Money that left", fmtCap(leaving)]],
    hint: "Other shares, bonds, cash: what the funds bought beyond their sales, and sold beyond their purchases (an estimate)",
  };
}
