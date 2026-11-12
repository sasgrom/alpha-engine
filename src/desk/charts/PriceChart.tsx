/**
 * Price history with a crosshair: a 2px accent line over a 10% wash, solid hairline grid, the latest close pinned
 * at the right edge, earnings reports as ringed markers, and — when option data exists — the options-implied range
 * as a translucent cone after the last close. Keyboard: focus the chart, then arrow keys, Home and End.
 */
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmtDate, fmtPct, fmtPrice } from "../format";
import { labelInk, type ChartPalette } from "./color";
import { linear, niceTicks, useWidth } from "./scale";

export interface PricePoint {
  date: string;
  close: number;
}

export interface ImpliedCone {
  /** Calendar days ahead and the straddle-implied move until then, as a fraction. */
  points: { days: number; pct: number }[];
  label: string;
}

const MARGIN = { top: 14, right: 64, bottom: 28, left: 8 };

export function PriceChart({ points, events = [], cone = null, height = 320, palette }: { points: PricePoint[]; events?: string[]; cone?: ImpliedCone | null; height?: number; palette: ChartPalette }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const layout = useMemo(() => {
    if (n < 2 || plotW <= 0) return null;
    const conePoints = (cone?.points ?? []).filter((point) => point.days > 0 && point.pct > 0).sort((a, b) => a.days - b.days);
    const maxConeSlots = Math.round(n * 0.25);
    const coneSlots = conePoints.length ? Math.min(maxConeSlots, Math.max(3, Math.round((conePoints.at(-1)!.days * 252) / 365))) : 0;
    const slots = n - 1 + coneSlots;
    const x = (index: number) => MARGIN.left + (index / slots) * plotW;
    const last = points[n - 1].close;
    const closes = points.map((point) => point.close);
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    const coneSlot = (days: number) => Math.min(coneSlots, Math.max(1, Math.round((days * 252) / 365)));
    for (const point of conePoints) {
      if (coneSlot(point.days) > coneSlots) continue;
      min = Math.min(min, last * (1 - point.pct));
      max = Math.max(max, last * (1 + point.pct));
    }
    const pad = (max - min) * 0.06 || max * 0.02;
    const ticks = niceTicks(min - pad, max + pad, 4);
    const y = linear([min - pad, max + pad], [MARGIN.top + plotH, MARGIN.top]);
    const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.close).toFixed(1)}`).join("");
    const area = `${line}L${x(n - 1).toFixed(1)},${MARGIN.top + plotH}L${x(0).toFixed(1)},${MARGIN.top + plotH}Z`;
    const visibleCone = conePoints.filter((point) => coneSlot(point.days) <= coneSlots);
    const conePath = visibleCone.length
      ? [
          `M${x(n - 1).toFixed(1)},${y(last).toFixed(1)}`,
          ...visibleCone.map((point) => `L${x(n - 1 + coneSlot(point.days)).toFixed(1)},${y(last * (1 + point.pct)).toFixed(1)}`),
          ...[...visibleCone].reverse().map((point) => `L${x(n - 1 + coneSlot(point.days)).toFixed(1)},${y(last * (1 - point.pct)).toFixed(1)}`),
          "Z",
        ].join("")
      : null;
    const span = (new Date(points[n - 1].date).getTime() - new Date(points[0].date).getTime()) / 86_400_000;
    const labelCount = Math.max(2, Math.min(6, Math.floor(plotW / 110)));
    const xLabels = Array.from({ length: labelCount }, (_, k) => Math.round((k / (labelCount - 1)) * (n - 1))).map((index) => ({
      index,
      text: span > 400 ? new Date(`${points[index].date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : fmtDate(points[index].date, "short"),
    }));
    const byDate = new Map(points.map((point, index) => [point.date, index]));
    const markers = events.map((date) => byDate.get(date)).filter((index): index is number => index !== undefined);
    return { x, y, ticks, line, area, conePath, visibleCone, coneSlot, xLabels, markers: new Set(markers), last };
  }, [points, n, plotW, plotH, cone, events]);

  if (!layout) return <div ref={ref} className="desk-chart" style={{ height }} />;
  const { x, y, ticks, line, area, conePath, visibleCone, coneSlot, xLabels, markers, last } = layout;
  const active = hover === null ? null : points[hover];
  const first = points[0].close;

  const indexAt = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const slots = (x(n - 1) - MARGIN.left) / plotW;
    return Math.max(0, Math.min(n - 1, Math.round((ratio / slots) * (n - 1))));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") setHover((current) => Math.max(0, (current ?? n - 1) - step));
    else if (event.key === "ArrowRight") setHover((current) => Math.min(n - 1, (current ?? n - 1) + step));
    else if (event.key === "Home") setHover(0);
    else if (event.key === "End") setHover(n - 1);
    else if (event.key === "Escape") setHover(null);
    else return;
    event.preventDefault();
  };
  const tooltipLeft = hover === null ? 0 : x(hover) > width * 0.62 ? x(hover) - 196 : x(hover) + 14;
  const outer = visibleCone.at(-1);

  return (
    <div ref={ref} className="desk-chart" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Closing prices from ${fmtDate(points[0].date)} to ${fmtDate(points[n - 1].date)}; last close ${fmtPrice(last)}`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <g className="grid">
          {ticks.map((tick) => (
            <line key={tick} x1={MARGIN.left} x2={MARGIN.left + plotW} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((tick) => (
            <text key={tick} x={width - 4} y={y(tick) + 4} textAnchor="end">
              {tick >= 1000 ? tick.toLocaleString("en-US", { maximumFractionDigits: 0 }) : tick.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </text>
          ))}
          {xLabels.map((label, k) => (
            <text key={label.index} x={x(label.index)} y={height - 8} textAnchor={k === 0 ? "start" : k === xLabels.length - 1 ? "end" : "middle"}>
              {label.text}
            </text>
          ))}
        </g>
        {conePath && <path d={conePath} fill={palette.accent} fillOpacity={0.09} stroke={palette.accent} strokeOpacity={0.4} strokeWidth={1} />}
        {conePath && outer && (
          <text className="desk-axis-text" x={x(n - 1 + coneSlot(outer.days)) - 4} y={y(last * (1 + outer.pct)) - 6} textAnchor="end">
            ±{fmtPct(outer.pct, 1, false)} in {outer.days}d
          </text>
        )}
        <path d={area} fill={palette.accent} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={palette.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {[...markers].map((index) => (
          <circle key={index} cx={x(index)} cy={y(points[index].close)} r={4} fill={palette.ink} stroke={palette.surface} strokeWidth={2} />
        ))}
        <g>
          <rect x={x(n - 1) + 6} y={y(last) - 10} width={MARGIN.right - 10} height={20} rx={6} fill={palette.accent} />
          <text x={x(n - 1) + 6 + (MARGIN.right - 10) / 2} y={y(last) + 4} textAnchor="middle" fill={labelInk(palette.accent)} fontSize={11} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
            {last >= 1000 ? last.toFixed(0) : last.toFixed(2)}
          </text>
        </g>
        {active && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke={palette.muted} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(active.close)} r={4.5} fill={palette.accent} stroke={palette.surface} strokeWidth={2} />
          </g>
        )}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={(event) => setHover(indexAt(event))}
          onPointerDown={(event) => setHover(indexAt(event))}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {active && hover !== null && (
        <div className="desk-tooltip" style={{ left: tooltipLeft, top: MARGIN.top }}>
          <strong>{fmtPrice(active.close)}</strong>
          <div>{fmtDate(active.date, "weekday")}, {active.date.slice(0, 4)}</div>
          <div className="row">
            <span>Since {fmtDate(points[0].date, "short")}</span>
            <span>{fmtPct(active.close / first - 1, 1)}</span>
          </div>
          {markers.has(hover) && <div className="row"><span>Earnings report</span><span>●</span></div>}
        </div>
      )}
    </div>
  );
}
