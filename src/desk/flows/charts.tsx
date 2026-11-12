/**
 * Flat charts of the fund-flow view. One grammar throughout: blue is money bought or arriving, red is money sold
 * or leaving, gray is context; every ribbon is red where it was sold and blue where it was bought.
 */
import { useMemo, useState } from "react";
import { FLOW_OUTSIDE, type FlowQuarter, type FundSeriesPoint } from "@contracts/fund-flows";
import { divergingColor, type ChartPalette } from "../charts/color";
import { linear, niceTicks, useWidth } from "../charts/scale";
import { fmtCap, fmtPct } from "../format";
import { quarterLabel, shortQuarter } from "./data";

// ---------------------------------------------------------------------------
// timeline: bought above the line, sold below, one column per quarter
// ---------------------------------------------------------------------------
export function FlowTimeline({ quarters, selected, onSelect, palette, height = 132 }: { quarters: FlowQuarter[]; selected: string; onSelect: (quarter: string) => void; palette: ChartPalette; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...quarters.map((row) => Math.max(row.bought, row.sold)));
  const band = quarters.length ? Math.max(0, width) / quarters.length : 0;
  const bar = Math.min(22, Math.max(4, band - 6));
  const half = (height - 22) / 2;
  const active = hover === null ? null : quarters[hover];
  return (
    <div ref={ref} className="desk-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Dollars bought and sold by the tracked funds, by quarter">
          <line x1={0} x2={width} y1={half + 0.5} y2={half + 0.5} stroke={palette.axis} strokeWidth={1} />
          {quarters.map((row, index) => {
            const x = index * band + (band - bar) / 2;
            const up = (row.bought / max) * (half - 4);
            const down = (row.sold / max) * (half - 4);
            const isSelected = row.quarter === selected;
            return (
              <g key={row.quarter} onMouseEnter={() => setHover(index)} onClick={() => onSelect(row.quarter)} style={{ cursor: "pointer" }}>
                <rect x={index * band} y={0} width={band} height={height} fill={isSelected ? palette.accent : "transparent"} fillOpacity={isSelected ? 0.1 : 0} />
                <path d={`M${x},${half - 1} v${-(up - 3)} a3,3 0 0 1 3,-3 h${bar - 6} a3,3 0 0 1 3,3 v${up - 3} z`} fill={palette.pos} opacity={isSelected || hover === index ? 1 : 0.72} />
                <path d={`M${x},${half + 2} v${down - 3} a3,3 0 0 0 3,3 h${bar - 6} a3,3 0 0 0 3,-3 v${-(down - 3)} z`} fill={palette.neg} opacity={isSelected || hover === index ? 1 : 0.72} />
                {(row.quarter.slice(5, 7) === "03" || index === 0) && (
                  <text className="desk-axis-text" x={index * band + 2} y={height - 5}>{row.quarter.slice(0, 4)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {active && hover !== null && (
        <div className="desk-tooltip" style={{ left: Math.min(Math.max(0, hover * band - 60), Math.max(0, width - 200)), top: -6, transform: "translateY(-100%)" }}>
          <strong>{quarterLabel(active.quarter)}</strong>
          <div className="row"><span>Bought</span><span>{fmtCap(active.bought)}</span></div>
          <div className="row"><span>Sold</span><span>{fmtCap(active.sold)}</span></div>
          <div className="row"><span>Net</span><span>{active.net < 0 ? "−" : "+"}{fmtCap(Math.abs(active.net))}</span></div>
          <div className="row"><span>Funds counted</span><span>{active.funds}</span></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// rotation: sectors sold on the left, sectors bought on the right, ribbons between
// ---------------------------------------------------------------------------
interface Node { name: string; total: number; y: number; h: number; cursor: number }

export function RotationDiagram({ quarter, focus, onFocus, palette, height = 440 }: { quarter: FlowQuarter; focus: string | null; onFocus: (sector: string | null) => void; palette: ChartPalette; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ from: string; to: string; usd: number; x: number; y: number } | null>(null);
  const layout = useMemo(() => {
    if (width <= 0) return null;
    const label = Math.min(190, Math.max(96, width * 0.24));
    const x0 = label;
    const x1 = width - label;
    const pad = 6;
    const side = (pick: "from" | "to") => {
      const totals = new Map<string, number>();
      for (const link of quarter.rotation) totals.set(link[pick], (totals.get(link[pick]) ?? 0) + link.usd);
      const names = [...totals].sort((a, b) => (a[0] === FLOW_OUTSIDE ? 1 : b[0] === FLOW_OUTSIDE ? -1 : b[1] - a[1]));
      const sum = names.reduce((total, [, value]) => total + value, 0);
      const scale = sum > 0 ? (height - 16 - pad * (names.length - 1)) / sum : 0;
      let y = 8;
      const nodes = new Map<string, Node>();
      for (const [name, total] of names) {
        nodes.set(name, { name, total, y, h: Math.max(1, total * scale), cursor: y });
        y += Math.max(1, total * scale) + pad;
      }
      return { nodes, scale };
    };
    const left = side("from");
    const right = side("to");
    const ribbons = [...quarter.rotation]
      .sort((a, b) => (left.nodes.get(a.from)!.y - left.nodes.get(b.from)!.y) || (right.nodes.get(a.to)!.y - right.nodes.get(b.to)!.y))
      .map((link) => {
        const from = left.nodes.get(link.from)!;
        const to = right.nodes.get(link.to)!;
        const h0 = link.usd * left.scale;
        const h1 = link.usd * right.scale;
        const a = from.cursor;
        const b = to.cursor;
        from.cursor += h0;
        to.cursor += h1;
        const mid = (x0 + x1) / 2;
        return { link, d: `M${x0 + 12},${a} C${mid},${a} ${mid},${b} ${x1 - 12},${b} L${x1 - 12},${b + h1} C${mid},${b + h1} ${mid},${a + h0} ${x0 + 12},${a + h0} Z` };
      });
    return { x0, x1, left: [...left.nodes.values()], right: [...right.nodes.values()], ribbons };
  }, [quarter, width, height]);

  if (!layout) return <div ref={ref} className="desk-chart" style={{ height }} />;
  const lit = (from: string, to: string) => focus === null || from === focus || to === focus;
  const nodeLabel = (node: Node, sideName: "left" | "right") => {
    const x = sideName === "left" ? layout.x0 - 8 : layout.x1 + 8;
    const dim = focus !== null && node.name !== focus;
    return (
      <g key={`${sideName}-${node.name}`} opacity={dim ? 0.45 : 1} style={{ cursor: "pointer" }} onClick={() => onFocus(focus === node.name ? null : node.name)}>
        <rect x={sideName === "left" ? layout.x0 : layout.x1 - 12} y={node.y} width={12} height={node.h} rx={3} fill={sideName === "left" ? palette.neg : palette.pos} />
        {node.h >= 11 && (
          <text x={x} y={node.y + Math.min(node.h / 2 + 4, 14)} textAnchor={sideName === "left" ? "end" : "start"} fontSize={12} fill={palette.ink} fontWeight={focus === node.name ? 650 : 500}>
            {node.name === FLOW_OUTSIDE ? (sideName === "left" ? "New money" : "Left the covered stocks") : node.name}
            <tspan fill={palette.muted} fontWeight={400}> {fmtCap(node.total)}</tspan>
          </text>
        )}
      </g>
    );
  };
  return (
    <div ref={ref} className="desk-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={`Estimated rotation between sectors in ${quarterLabel(quarter.quarter)}: sold on the left, bought on the right`}>
        <defs>
          <linearGradient id="desk-flow-ribbon" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={palette.neg} />
            <stop offset="1" stopColor={palette.pos} />
          </linearGradient>
        </defs>
        {layout.ribbons.map(({ link, d }) => (
          <path
            key={`${link.from}|${link.to}`}
            d={d}
            fill="url(#desk-flow-ribbon)"
            opacity={lit(link.from, link.to) ? (focus === null ? 0.34 : 0.8) : 0.06}
            style={{ transition: "opacity 160ms ease, d 600ms ease" }}
            onMouseMove={(event) => {
              const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              setHover({ ...link, x: event.clientX - box.left, y: event.clientY - box.top });
            }}
          />
        ))}
        {layout.left.map((node) => nodeLabel(node, "left"))}
        {layout.right.map((node) => nodeLabel(node, "right"))}
      </svg>
      {hover && (
        <div className="desk-tooltip" style={{ left: Math.min(hover.x + 14, width - 230), top: Math.max(0, hover.y - 56), width: 216 }}>
          <strong>{fmtCap(hover.usd)}</strong>
          <div>{hover.from === FLOW_OUTSIDE ? "New money" : hover.from} → {hover.to === FLOW_OUTSIDE ? "left the covered stocks" : hover.to}</div>
          <div className="desk-muted">estimate: each fund's sales paired with its own purchases</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// tape: sector by quarter, net flow as a share of what the funds held
// ---------------------------------------------------------------------------
export function FlowTape({ quarters, selected, onSelect, palette }: { quarters: FlowQuarter[]; selected: string; onSelect: (quarter: string, sector: string) => void; palette: ChartPalette }) {
  const sectors = useMemo(() => {
    const names = new Set<string>();
    for (const row of quarters) for (const sector of row.sectors) if (sector.sector !== "Other") names.add(sector.sector);
    return [...names].sort();
  }, [quarters]);
  const share = (row: FlowQuarter, name: string) => {
    const sector = row.sectors.find((entry) => entry.sector === name);
    return sector && sector.held > 0 ? sector.net / sector.held : null;
  };
  const limit = useMemo(() => {
    const values = quarters.flatMap((row) => sectors.map((name) => Math.abs(share(row, name) ?? 0))).sort((a, b) => a - b);
    return values[Math.floor(values.length * 0.92)] || 0.01;
  }, [quarters, sectors]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12, width: "100%" }} aria-label="Net flow by sector and quarter as a share of the value held">
        <thead>
          <tr>
            <th />
            {quarters.map((row) => (
              <th key={row.quarter} className="desk-muted" style={{ fontWeight: 400, fontSize: 11, textAlign: "left", padding: "0 0 2px" }}>{row.quarter.slice(5, 7) === "03" ? row.quarter.slice(0, 4) : ""}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectors.map((name) => (
            <tr key={name}>
              <th scope="row" style={{ textAlign: "right", fontWeight: 500, padding: "0 8px 0 0", whiteSpace: "nowrap", color: palette.ink }}>{name}</th>
              {quarters.map((row) => {
                const value = share(row, name);
                return (
                  <td
                    key={row.quarter}
                    title={`${name}, ${quarterLabel(row.quarter)}: ${value === null ? "no data" : `${fmtPct(value, 2)} of the value held`}`}
                    onClick={() => onSelect(row.quarter, name)}
                    style={{ background: divergingColor(value, limit, palette), height: 20, minWidth: 14, borderRadius: 3, cursor: "pointer", outline: row.quarter === selected ? `2px solid ${palette.ink}` : "none", outlineOffset: -1 }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="desk-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        Each cell: the sector's net flow in the quarter as a share of what the funds held in it. Blue bought, red sold; the scale ends at ±{fmtPct(limit, 1, false)}.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// growth of one dollar: the fund's reported books against all funds, optionally after inflation
// ---------------------------------------------------------------------------
export function GrowthChart({ series, real, palette, height = 190 }: { series: FundSeriesPoint[]; real: boolean; palette: ChartPalette; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const usable = series.filter((point) => point.growth !== null);
    const base = series.find((point) => point.cpi !== null)?.cpi ?? null;
    const deflate = (value: number | null, cpi: number | null) => (value === null ? null : real && base && cpi ? value / (cpi / base) : value);
    return usable.map((point) => ({ quarter: point.quarter, fund: deflate(point.growth, point.cpi)!, all: deflate(point.growthAllFunds, point.cpi) }));
  }, [series, real]);
  if (points.length < 2) return <div ref={ref} className="desk-empty">Not enough consecutive quarters for a growth line.</div>;
  const values = points.flatMap((point) => [point.fund, ...(point.all === null ? [] : [point.all]), 1]);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 3);
  const margin = { left: 6, right: 70, top: 10, bottom: 20 };
  const x = (index: number) => margin.left + (index / (points.length - 1)) * Math.max(1, width - margin.left - margin.right);
  const y = linear([Math.min(...values) * 0.97, Math.max(...values) * 1.03], [height - margin.bottom, margin.top]);
  const path = (pick: (point: (typeof points)[number]) => number | null) => points.map((point, index) => (pick(point) === null ? "" : `${index ? "L" : "M"}${x(index).toFixed(1)},${y(pick(point)!).toFixed(1)}`)).join("");
  const last = points[points.length - 1];
  const active = hover === null ? null : points[hover];
  return (
    <div ref={ref} className="desk-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Growth of one dollar in the fund's reported books against all tracked funds"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - box.left - margin.left) / Math.max(1, width - margin.left - margin.right);
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
          }}>
          <g className="grid">{ticks.map((tick) => <line key={tick} x1={margin.left} x2={width - margin.right} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />)}</g>
          <g className="axis">
            {ticks.map((tick) => <text key={tick} x={width - margin.right + 6} y={y(tick) + 4}>${tick.toFixed(2)}</text>)}
            <text x={margin.left} y={height - 5}>{shortQuarter(points[0].quarter)}</text>
            <text x={x(points.length - 1)} y={height - 5} textAnchor="end">{shortQuarter(last.quarter)}</text>
          </g>
          <path d={path((point) => point.all)} fill="none" stroke={palette.muted} strokeWidth={2} strokeLinejoin="round" />
          <path d={path((point) => point.fund)} fill="none" stroke={palette.accent} strokeWidth={2} strokeLinejoin="round" />
          <circle cx={x(points.length - 1)} cy={y(last.fund)} r={4} fill={palette.accent} stroke={palette.surface} strokeWidth={2} />
          {active && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={margin.top} y2={height - margin.bottom} stroke={palette.muted} strokeWidth={1} />}
        </svg>
      )}
      {active && hover !== null && (
        <div className="desk-tooltip" style={{ left: Math.min(x(hover) + 12, Math.max(0, width - 190)), top: 0 }}>
          <strong>${active.fund.toFixed(2)}</strong>
          <div>{quarterLabel(active.quarter)}{real ? " · after inflation" : ""}</div>
          <div className="row"><span>All tracked funds</span><span>{active.all === null ? "—" : `$${active.all.toFixed(2)}`}</span></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// signed bars: one value per quarter, blue above zero, red below
// ---------------------------------------------------------------------------
export function SignedBars({ items, format, palette, height = 96, label }: { items: { quarter: string; value: number | null }[]; format: (value: number) => string; palette: ChartPalette; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-9, ...items.map((item) => Math.abs(item.value ?? 0)));
  const band = items.length ? Math.max(0, width) / items.length : 0;
  const bar = Math.min(20, Math.max(3, band - 4));
  const mid = (height - 16) / 2;
  const active = hover === null ? null : items[hover];
  return (
    <div ref={ref} className="desk-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <line x1={0} x2={width} y1={mid + 0.5} y2={mid + 0.5} stroke={palette.axis} strokeWidth={1} />
          {items.map((item, index) => {
            const size = item.value === null ? 0 : Math.max(1, (Math.abs(item.value) / max) * (mid - 3));
            const positive = (item.value ?? 0) >= 0;
            return (
              <g key={item.quarter} onMouseEnter={() => setHover(index)}>
                <rect x={index * band} y={0} width={band} height={height} fill="transparent" />
                {item.value !== null && <rect x={index * band + (band - bar) / 2} y={positive ? mid - size : mid + 1} width={bar} height={size} rx={2} fill={positive ? palette.pos : palette.neg} opacity={hover === index ? 1 : 0.8} />}
                {(item.quarter.slice(5, 7) === "03" || index === 0) && <text className="desk-axis-text" x={index * band + 1} y={height - 3}>{item.quarter.slice(0, 4)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {active && hover !== null && (
        <div className="desk-tooltip" style={{ left: Math.min(Math.max(0, hover * band - 50), Math.max(0, width - 170)), top: -4, transform: "translateY(-100%)", minWidth: 130 }}>
          <strong>{active.value === null ? "—" : format(active.value)}</strong>
          <div>{quarterLabel(active.quarter)}</div>
        </div>
      )}
    </div>
  );
}
