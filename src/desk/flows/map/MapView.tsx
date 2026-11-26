/**
 * The money map's page parts: the people on the left (famous faces and the funds by kind, with search), the map in
 * the middle, the details of the quarter or the selection on the right, the timeline under the map. Nothing floats
 * over the map (owner, 2026-11-26: the hall's floating panels obstructed the view and the switches were hard to find).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { FUND_CATEGORY_LABEL, type FlowActivistsFile, type FlowInsidersFile, type FundCategory, type FlowQuarter, type FundFlowsCompany, type FundFlowsFund, type FundFlowsOverview } from "@contracts/fund-flows";
import type { ChartPalette } from "../../charts/color";
import { divergingColor } from "../../charts/color";
import { fmtCap, fmtPct, personName } from "../../format";
import { ACTIVIST_FUNDS, FAMOUS_FACES } from "../hall/famous";
import { quarterLabel } from "../data";
import MoneyMap, { type MapPerson, type MapPick, type MapThread } from "./MoneyMap";
import { buildMapPlan, initialsOf, placePeople, type Tile } from "./layout";

type Mode = "flow" | "outcome" | "held";
type Group = "famous" | "insiders" | "activists" | FundCategory;
/** A person standing on a company's tile (an insider, or a 13D filer), as the list and the map show it. */
interface TileRow { id: number; cik: number; ticker: string; label: string; sub: string; tone: MapPerson["tone"]; right: string; size: number; hover: string[] }
const STAKE_KIND = { new: "new stake", raised: "raised", cut: "cut", held: "unchanged", exited: "below 5%" } as const;
// short names for the chips; the full name is the chip's title
const SHORT: Record<FundCategory, string> = { index: "Index giants", manager: "Managers", quant: "Quant", hedge: "Hedge & activists", pension: "Pensions", bank: "Banks & insurers" };
const GROUPS: { key: Group; label: string; title: string }[] = [
  { key: "famous", label: "Famous faces", title: "The best-known people behind the funds" },
  { key: "insiders", label: "Insiders", title: "Executives, directors and large owners trading their own company's shares on the open market (Form 4)" },
  { key: "activists", label: "Activists", title: "Stakes above 5% reported on Schedule 13D this quarter, and the activist funds' 13F books" },
  ...(Object.entries(FUND_CATEGORY_LABEL) as [FundCategory, string][]).map(([key, title]) => ({ key, label: SHORT[key], title })),
];
/** At most this many pins of a group stand on the map (the largest); the list shows them all. */
const PINS = 60;
const FAMOUS = new Map(FAMOUS_FACES.map((face) => [face.cik, face]));

interface Props {
  data: FundFlowsOverview;
  row: FlowQuarter;
  mode: Mode;
  deflator: number;
  palette: ChartPalette;
  dark: boolean;
  focus: string | null;
  fund: number | null;
  company: number | null;
  fundFile: FundFlowsFund | undefined;
  companyFile: FundFlowsCompany | undefined;
  insiders: FlowInsidersFile | null | undefined;
  activists: FlowActivistsFile | null | undefined;
  onPick: (pick: MapPick) => void;
  bar: ReactNode;
  panel: ReactNode | null;
  foot: ReactNode;
}

export default function MapView(props: Props) {
  const { data, row, mode, deflator, palette, dark, focus, fund, company, fundFile, companyFile, insiders, activists, onPick } = props;
  const [group, setGroup] = useState<Group>("famous");
  const [query, setQuery] = useState("");

  const plan = useMemo(() => buildMapPlan(data, 1600, 1000), [data]);
  const fundsByCik = useMemo(() => new Map(data.funds.map((entry) => [entry.cik, entry])), [data]);
  const companiesByCik = useMemo(() => new Map(data.companies.map((entry) => [entry.cik, entry])), [data]);
  const flows = useMemo(() => new Map(row.companyFlows.map(([cik, net, held, since]) => [cik, { net, held, since }])), [row]);
  const fundFlows = useMemo(() => new Map(row.fundFlows.map(([cik, bought, sold]) => [cik, { bought, sold }])), [row]);
  const fundReturns = useMemo(() => new Map(row.fundReturns), [row]);
  const homes = useMemo(() => new Map(row.places.map((place) => [place[0], place[1] >= 0 ? data.sectorNames[place[1]] ?? null : null])), [row, data]);

  // what the funds held a quarter earlier, for "What is held": the change in the value held (prices and trades together)
  const previousHeld = useMemo(() => {
    const index = data.quarters.findIndex((quarter) => quarter.quarter === row.quarter);
    const previous = index > 0 ? data.quarters[index - 1] : null;
    return new Map((previous?.companyFlows ?? []).map(([cik, , held]) => [cik, held]));
  }, [data, row]);

  // tile colours of the quarter: blue for growth, red for loss in every mode (owner, 2026-11-26: "brown color doesnt
  // look good, blue for growing, red for loss would work better"); the size of a tile already says how much is held
  const fills = useMemo(() => {
    const out = new Map<number, string>();
    for (const tile of plan.tiles) {
      const flow = flows.get(tile.cik);
      if (mode === "held") {
        const held = flow?.held ?? 0, before = previousHeld.get(tile.cik) ?? 0;
        out.set(tile.cik, divergingColor(held > 0 && before > 0 ? held / before - 1 : null, 0.25, palette));
      } else if (mode === "outcome") {
        const since = flow?.since ?? null;
        out.set(tile.cik, divergingColor(since === null ? null : (1 + since) / deflator - 1, 0.6, palette));
      } else {
        out.set(tile.cik, divergingColor(flow && flow.held > 0 ? flow.net / flow.held : null, 0.03, palette));
      }
    }
    return out;
  }, [plan, flows, previousHeld, mode, deflator, palette]);

  const streams = useMemo(() => (mode === "flow" ? row.rotation.filter((link) => link.from !== link.to).sort((a, b) => b.usd - a.usd).slice(0, 10) : []), [row, mode]);

  const toneOf = (cik: number): MapPerson["tone"] => {
    const own = fundReturns.get(cik), all = row.allFundsReturn;
    if (own === undefined || all === null) return "flat";
    return own - all > 0.002 ? "up" : own - all < -0.002 ? "down" : "flat";
  };
  const labelOf = (cik: number) => FAMOUS.get(cik)?.name ?? shortName(fundsByCik.get(cik)?.name ?? String(cik));

  // who is listed: the group's funds that reported this quarter, largest first, or everyone matching the search
  const inInsiders = group === "insiders";
  // people who stand on a company's tile: the quarter's insiders (their own company), or the quarter's 13D stakes (the
  // company they hold more than 5% of); ids are negative so they never meet a fund's CIK
  const tileRows = useMemo<TileRow[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string, ticker: string) => !q || label.toLowerCase().includes(q) || ticker.toLowerCase() === q;
    if (group === "insiders") {
      return (insiders?.quarters[row.quarter] ?? []).filter((entry) => plan.tileByCik.has(entry.cik)).map((entry, index) => {
        const ticker = plan.tileByCik.get(entry.cik)!.ticker, label = personName(entry.name), net = entry.bought - entry.sold;
        return {
          id: -(index + 1), cik: entry.cik, ticker, label, sub: `${entry.title ?? "Owner (10% or other)"} · ${ticker}`,
          tone: net > 0 ? "up" as const : "down" as const, right: `${net < 0 ? "−" : "+"}${fmtCap(Math.abs(net))}`,
          size: Math.min(1, Math.max(0, (Math.log10(Math.max(entry.bought + entry.sold, 1)) - 6) / 4)),
          hover: [`${label}${entry.title ? ` · ${entry.title}` : ""}`, `${ticker} · ${quarterLabel(row.quarter)}: bought ${fmtCap(entry.bought)} · sold ${fmtCap(entry.sold)} on the open market`, "Form 4 reports (the insider standard)", "Click: the company and who traded it"],
        };
      }).filter((entry) => matches(entry.label, entry.ticker));
    }
    if (group === "activists") {
      return (activists?.quarters[row.quarter] ?? []).filter((entry) => plan.tileByCik.has(entry.cik)).map((entry, index) => {
        const ticker = plan.tileByCik.get(entry.cik)!.ticker, label = shortName(entry.filer);
        const pct = entry.percent === null ? "a stake" : `${entry.percent.toFixed(1)}%`;
        return {
          id: -(index + 1), cik: entry.cik, ticker, label, sub: `${pct} of ${ticker} · ${STAKE_KIND[entry.kind]}`,
          tone: entry.kind === "new" || entry.kind === "raised" ? "up" as const : entry.kind === "held" ? "flat" as const : "down" as const,
          right: entry.percent === null ? "—" : `${entry.percent.toFixed(1)}%`,
          size: Math.min(1, Math.max(0.15, ((entry.percent ?? 5) - 5) / 25)),
          hover: [label, `${pct} of ${ticker}${entry.previous !== null ? ` (was ${entry.previous.toFixed(1)}%)` : ""} · ${STAKE_KIND[entry.kind]}, filed ${entry.filed}`, `Schedule 13D${entry.filings > 1 ? `, ${entry.filings} filings this quarter` : ""}`, "Click: the company and who traded it"],
        };
      }).filter((entry) => matches(entry.label, entry.ticker));
    }
    return [];
  }, [group, insiders, activists, row, plan, query]);
  const tileRowById = useMemo(() => new Map(tileRows.map((entry) => [entry.id, entry])), [tileRows]);

  const listed = useMemo(() => {
    if (group === "insiders") return [];
    const reported = new Set(row.places.map((place) => place[0]));
    const q = query.trim().toLowerCase();
    return data.funds
      .filter((entry) => reported.has(entry.cik))
      .filter((entry) => (q ? entry.name.toLowerCase().includes(q) || (FAMOUS.get(entry.cik)?.name.toLowerCase().includes(q) ?? false) : group === "famous" ? FAMOUS.has(entry.cik) : group === "activists" ? ACTIVIST_FUNDS.has(entry.cik) : entry.category === group))
      .sort((a, b) => b.tracked - a.tracked);
  }, [data, row, group, query]);

  // the selection's threads, and the people who must stand on the map for them
  const threads = useMemo<MapThread[]>(() => {
    if (fund && fundFile?.cik === fund) {
      const moves = fundFile.moves.find((entry) => entry.quarter === row.quarter);
      return moves ? [...moves.buys.map((move) => ({ id: move.cik, usd: Math.abs(move.usd), way: "in" as const })), ...moves.sells.map((move) => ({ id: move.cik, usd: Math.abs(move.usd), way: "out" as const }))] : [];
    }
    if (company && companyFile?.cik === company) {
      const trades = companyFile.quarters.find((entry) => entry.quarter === row.quarter);
      return trades ? [...trades.buyers.map((trade) => ({ id: trade.cik, usd: Math.abs(trade.usd), way: "in" as const })), ...trades.sellers.map((trade) => ({ id: trade.cik, usd: Math.abs(trade.usd), way: "out" as const }))] : [];
    }
    return [];
  }, [fund, company, fundFile, companyFile, row]);

  const people = useMemo<MapPerson[]>(() => {
    const ciks = new Set(listed.slice(0, PINS).map((entry) => entry.cik));
    if (fund) ciks.add(fund);
    if (company) for (const thread of threads) ciks.add(thread.id);
    const maxLog = 12.3, minLog = 9;
    const funds: MapPerson[] = [...ciks].filter((cik) => fundsByCik.has(cik)).map((cik) => {
      const entry = fundsByCik.get(cik)!;
      return {
        cik,
        label: labelOf(cik),
        initials: initialsOf(labelOf(cik)),
        size: Math.min(1, Math.max(0, (Math.log10(Math.max(entry.tracked, 1)) - minLog) / (maxLog - minLog))),
        tone: toneOf(cik),
        named: FAMOUS.has(cik) && group === "famous" && !query,
      };
    });
    const onTiles: MapPerson[] = tileRows.slice(0, PINS).map((entry) => ({
      cik: entry.id, label: `${entry.label} · ${entry.ticker}`, initials: initialsOf(entry.label), size: entry.size, tone: entry.tone, named: true, company: entry.cik,
    }));
    return [...funds, ...onTiles].sort((a, b) => b.size - a.size);
    // labelOf and toneOf read the memoized maps above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed, fund, company, threads, fundsByCik, group, query, fundReturns, row, tileRows]);

  const positions = useMemo(() => {
    const out = placePeople(plan, homes, people.filter((person) => person.company === undefined).map((person) => person.cik));
    // an insider on its company's tile; several of one company around its middle
    const used = new Map<number, number>();
    for (const person of people) {
      if (person.company === undefined) continue;
      const tile = plan.tileByCik.get(person.company);
      if (!tile) continue;
      const n = used.get(tile.cik) ?? 0;
      used.set(tile.cik, n + 1);
      const angle = n * 2.39996, radius = n ? 24 * Math.sqrt(n) : 0;
      out.set(person.cik, { x: (tile.x0 + tile.x1) / 2 + Math.cos(angle) * radius, y: (tile.y0 + tile.y1) / 2 + Math.sin(angle) * radius });
    }
    return out;
  }, [plan, homes, people]);

  const districtNote = (name: string) => {
    const sector = row.sectors.find((entry) => entry.sector === name);
    if (!sector) return "";
    if (mode === "held") {
      const before = data.quarters[data.quarters.findIndex((quarter) => quarter.quarter === row.quarter) - 1]?.sectors.find((entry) => entry.sector === name)?.held;
      return `${fmtCap(sector.held)}${before ? ` · ${fmtPct(sector.held / before - 1, 1)}` : ""}`;
    }
    if (mode === "flow") return `${sector.net < 0 ? "−" : "+"}${fmtCap(Math.abs(sector.net))}`;
    return "";
  };
  const describeTile = (tile: Tile) => {
    const flow = flows.get(tile.cik), entry = companiesByCik.get(tile.cik);
    const lines = [`${tile.ticker} · ${tile.name}`];
    if (flow) lines.push(`${quarterLabel(row.quarter)}: net ${flow.net < 0 ? "−" : "+"}${fmtCap(Math.abs(flow.net))} · held ${fmtCap(flow.held)}`);
    const before = previousHeld.get(tile.cik);
    if (flow && before) lines.push(`value held ${fmtPct(flow.held / before - 1, 1)} over the quarter (prices and trades)`);
    if (flow?.since !== null && flow?.since !== undefined) lines.push(`stock since then ${fmtPct((1 + flow.since) / deflator - 1, 1)}${deflator !== 1 ? " after inflation" : ""}`);
    if (entry) lines.push(`${entry.holders} tracked funds hold it now · ${entry.sector}`);
    lines.push("Click: who traded it");
    return lines;
  };
  const describePerson = (cik: number) => {
    const onTile = tileRowById.get(cik);
    if (onTile) return onTile.hover;
    const entry = fundsByCik.get(cik), face = FAMOUS.get(cik), flow = fundFlows.get(cik), own = fundReturns.get(cik);
    const lines = [face ? `${face.name} · ${face.role}` : entry?.name ?? String(cik)];
    if (face && entry) lines.push(entry.name);
    if (flow) lines.push(`${quarterLabel(row.quarter)}: bought ${fmtCap(flow.bought)} · sold ${fmtCap(flow.sold)}`);
    if (own !== undefined) lines.push(`book ${fmtPct(own, 1)} in the quarter${row.allFundsReturn !== null ? ` (all funds ${fmtPct(row.allFundsReturn, 1)})` : ""}`);
    if (entry) lines.push(`${fmtCap(entry.tracked)} in covered stocks · ${entry.positions} positions`);
    lines.push("Click: where its money went");
    return lines;
  };

  return (
    <div className="desk-map" data-panel={props.panel ? "open" : "closed"}>
      <div className="desk-map-bar">{props.bar}</div>
      <aside className="desk-map-people" aria-label="People">
        <div className="desk-map-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person or a fund" aria-label="Find a person or a fund" />
          {query && <button type="button" className="desk-icon-button" onClick={() => setQuery("")} aria-label="Clear the search"><X size={13} aria-hidden="true" /></button>}
        </div>
        {(!query || inInsiders) && (
          <div className="desk-map-groups" role="tablist" aria-label="Groups of people">
            {GROUPS.map((entry) => (
              <button key={entry.key} type="button" role="tab" aria-selected={group === entry.key} onClick={() => setGroup(entry.key)} title={entry.title}>{entry.label}</button>
            ))}
          </div>
        )}
        {inInsiders && <p className="desk-map-count">{tileRows.length} {query ? "found" : `largest open-market traders of ${quarterLabel(row.quarter)}`}{!insiders ? " · not built yet" : ""}</p>}
        {group === "activists" && <p className="desk-map-count">{tileRows.length} Schedule 13D stake{tileRows.length === 1 ? "" : "s"} filed in {quarterLabel(row.quarter)} · then the activist funds' 13F books</p>}
        {!inInsiders && group !== "activists" && <p className="desk-map-count">{listed.length} {query ? "found" : "reported this quarter"}{listed.length > PINS && !query ? ` · the ${PINS} largest stand on the map` : ""}</p>}
        <ul className="desk-map-list">
          {tileRows.map((entry) => (
            <li key={entry.id}>
              <button type="button" aria-pressed={company === entry.cik} onClick={() => onPick({ kind: "company", id: entry.cik })}>
                <span className="desk-map-avatar" data-tone={entry.tone} aria-hidden="true">{initialsOf(entry.label)}</span>
                <span className="desk-map-who">
                  <strong>{entry.label}</strong>
                  <span>{entry.sub}</span>
                </span>
                <span className="desk-map-net" data-way={entry.tone === "up" ? "in" : entry.tone === "down" ? "out" : undefined}>{entry.right}</span>
              </button>
            </li>
          ))}
          {listed.map((entry) => {
            const face = FAMOUS.get(entry.cik), flow = fundFlows.get(entry.cik), tone = toneOf(entry.cik), net = flow ? flow.bought - flow.sold : null;
            return (
              <li key={entry.cik}>
                <button type="button" aria-pressed={fund === entry.cik} onClick={() => onPick({ kind: "fund", id: entry.cik })}>
                  <span className="desk-map-avatar" data-tone={tone} aria-hidden="true">{initialsOf(face?.name ?? entry.name)}</span>
                  <span className="desk-map-who">
                    <strong>{face?.name ?? shortName(entry.name)}</strong>
                    <span>{face ? face.role : FUND_CATEGORY_LABEL[entry.category]}</span>
                  </span>
                  <span className="desk-map-net" data-way={net === null ? undefined : net >= 0 ? "in" : "out"}>{net === null ? "—" : `${net < 0 ? "−" : "+"}${fmtCap(Math.abs(net))}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="desk-map-note">Politicians are being collected and will join these lists.</p>
      </aside>
      <div className="desk-map-main">
        <MoneyMap
          plan={plan} fills={fills} people={people} positions={positions} streams={streams}
          selection={{ kind: fund ? "fund" : company ? "company" : null, id: fund ?? company, threads }}
          focus={focus} districtNote={districtNote} describeTile={describeTile} describePerson={describePerson}
          palette={palette} dark={dark} inset={{ left: 0, right: 0, top: 0, bottom: 0 }} onPick={onPick} quarterKey={`${row.quarter}|${mode}|${deflator}`}
        />
      </div>
      <div className="desk-map-foot">{props.foot}</div>
      {props.panel && <aside className="desk-map-panel" aria-label="Details">{props.panel}</aside>}
    </div>
  );
}

/** A filer's name without its legal tail ("BlackRock, Inc." → "BlackRock"). */
function shortName(name: string): string {
  const cleaned = name.replace(/,?\s+(inc|llc|l\.?p|ltd|corp|co|plc|n\.?a|lp|group|holdings?|management|advisors?|& co)\.?$/i, "").replace(/,?\s+(inc|llc|l\.?p|ltd)\.?$/i, "");
  // a name the tail is most of ("Link Co") stays whole
  if (cleaned.length < 6) return name.length > 34 ? `${name.slice(0, 33)}…` : name;
  return cleaned.length > 34 ? `${cleaned.slice(0, 33)}…` : cleaned;
}
