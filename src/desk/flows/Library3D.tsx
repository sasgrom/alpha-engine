/**
 * React frame of the library scene: builds the stage once per data set and theme, hands it the selected quarter
 * and the selection, and shows what the pointer rests on. All drawing is in library-stage.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_OUTSIDE, type FlowQuarter, type FundFlowsOverview } from "@contracts/fund-flows";
import type { ChartPalette } from "../charts/color";
import { fmtCap, fmtPct } from "../format";
import { deflatorSince, quarterLabel, signedCap } from "./data";
import { LibraryStage, type StageData, type StageSelection, type StageTarget } from "./library-stage";

export interface LibraryProps {
  overview: FundFlowsOverview;
  row: FlowQuarter;
  mode: "flow" | "outcome";
  /** Restate "what it earned" after inflation. */
  real: boolean;
  focus: string | null;
  selection: StageSelection;
  dark: boolean;
  palette: ChartPalette;
  /** Changes when the reader asks to be taken back to the entrance. */
  homeSignal: number;
  /** Pixels of the hall covered by the panel on the right (0 when it is closed) and by the strip at the bottom. */
  inset: number;
  insetBottom: number;
  onPick: (target: StageTarget) => void;
}

export default function Library3D({ overview, row, mode, real, focus, selection, dark, palette, homeSignal, inset, insetBottom, onPick }: LibraryProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<LibraryStage | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [hover, setHover] = useState<{ target: StageTarget; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(0);

  const company = useMemo(() => new Map(overview.companies.map((entry) => [entry.cik, entry])), [overview]);
  const fund = useMemo(() => new Map(overview.funds.map((entry) => [entry.cik, entry])), [overview]);
  const data = useMemo<StageData>(
    () => ({
      company: new Map(row.companyFlows.map(([cik, net, held, since]) => [cik, { net, held, since }])),
      fund: new Map(row.fundFlows.map(([cik, bought, sold]) => [cik, { bought, sold }])),
      sectors: new Map(row.sectors.map((sector) => [sector.sector, sector])),
      links: row.rotation,
      mode,
      deflator: real ? deflatorSince(overview, row) : 1,
      focus,
    }),
    [overview, row, mode, real, focus],
  );

  useEffect(() => {
    if (!host.current) return;
    const built = new LibraryStage(
      host.current,
      overview.companies.map((entry) => ({ cik: entry.cik, ticker: entry.ticker, name: entry.name, sector: entry.sector, held: entry.held })),
      overview.funds.map((entry) => ({ cik: entry.cik, name: entry.name, category: entry.category, tracked: entry.tracked })),
      dark,
      palette,
      {
        onHover: (target, x, y) => setHover(target ? { target, x, y } : null),
        onPick: (target) => target && pick.current(target),
      },
    );
    stage.current = built;
    setReady((count) => count + 1);
    return () => {
      stage.current = null;
      built.dispose();
    };
  }, [overview, dark, palette]);

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
    stage.current?.setInset(inset, insetBottom);
  }, [inset, insetBottom, ready]);

  const tip = hover && tooltip(hover.target, { overview, row, company, fund, data, real });
  return (
    <div className="desk-lib-stage">
      {/* the stage puts its canvas and labels in here; nothing React renders shares this element */}
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {tip && hover && (
        <div className="desk-tooltip desk-lib-tip" style={{ left: Math.min(hover.x + 16, (host.current?.clientWidth ?? 600) - 290), top: Math.max(8, hover.y - 12) }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((line) => (
            <div key={line[0]} className="row"><span>{line[0]}</span><span>{line[1]}</span></div>
          ))}
          <div className="desk-muted">{tip.hint}</div>
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
  if (target.kind === "fund") {
    const entry = context.fund.get(target.id);
    const flow = data.fund.get(target.id);
    return {
      title: entry?.name ?? `Fund ${target.id}`,
      lines: flow ? [[`Bought, ${quarter}`, fmtCap(flow.bought)], ["Sold", fmtCap(flow.sold)], ["Net", signedCap(flow.bought - flow.sold)]] : [[quarter, "no counted report"]],
      hint: "Select to follow its money to the shelves",
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
