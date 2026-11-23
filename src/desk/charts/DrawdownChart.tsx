/**
 * Distance below the highest close so far, session by session: a line hanging from the zero line with a light fill,
 * a hairline grid, and a crosshair with the date and the fall under the pointer. The deepest point is marked.
 */
import { useMemo, useState, type PointerEvent } from "react";
import { fmtDate, fmtPct } from "../format";
import type { ChartPalette } from "./color";
import { linear, niceTicks, useWidth } from "./scale";

const MARGIN = { top: 8, right: 10, bottom: 22, left: 46 };

export function DrawdownChart({ points, height = 170, palette }: { points: Array<{ date: string; value: number }>; height?: number; palette: ChartPalette }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = measured > 0 ? measured : 420;
  const layout = useMemo(() => {
    if (points.length < 2) return null;
    const low = Math.min(...points.map((point) => point.value));
    const ticks = niceTicks(Math.min(low, -0.01), 0, 3).filter((tick) => tick <= 0);
    const x = linear([0, points.length - 1], [MARGIN.left, width - MARGIN.right]);
    const y = linear([Math.min(ticks[0], low), 0], [height - MARGIN.bottom, MARGIN.top]);
    const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join("");
    const deepest = points.reduce((best, point, index) => (point.value < points[best].value ? index : best), 0);
    return { ticks, x, y, line, area: `${line}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`, deepest };
  }, [points, width, height]);
  if (!layout) return <div className="desk-empty" style={{ padding: "18px 0" }}>Not enough closes to chart.</div>;
  const { ticks, x, y, line, area, deepest } = layout;
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) * (width / (box.width || width)) - MARGIN.left) / (width - MARGIN.left - MARGIN.right);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(at * (points.length - 1)))));
  };
  const active = hover !== null ? points[hover] : null;
  // three date labels: the start, the middle and the end of the run
  const dates = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Fall from the highest close so far, ${points.length} sessions; deepest ${fmtPct(points[deepest].value, 1)} on ${fmtDate(points[deepest].date, "medium")}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: "block", touchAction: "pan-y" }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? palette.axis : palette.grid} strokeWidth={1} />
            <text x={MARGIN.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10.5} fill={palette.muted} style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPct(tick, 0, false)}</text>
          </g>
        ))}
        <path d={area} fill={palette.accent} opacity={0.14} />
        <path d={line} fill="none" stroke={palette.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle data-deepest={points[deepest].date} cx={x(deepest)} cy={y(points[deepest].value)} r={4} fill={palette.accent} stroke={palette.surface} strokeWidth={2} />
        {dates.map((index, position) => (
          <text key={index} x={x(index)} y={height - 6} textAnchor={position === 0 ? "start" : position === 2 ? "end" : "middle"} fontSize={10.5} fill={palette.muted}>{fmtDate(points[index].date, "medium")}</text>
        ))}
        {active && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke={palette.axis} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(active.value)} r={4} fill={palette.accent} stroke={palette.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      {active && hover !== null && (
        <span className="desk-tooltip" style={{ top: 4, minWidth: 150, ...(x(hover) > width / 2 ? { right: `${((width - x(hover) + 10) / width) * 100}%` } : { left: `${((x(hover) + 10) / width) * 100}%` }) }}>
          <strong>{active.value === 0 ? "At the high" : fmtPct(active.value, 1)}</strong>
          {fmtDate(active.date, "medium")}
        </span>
      )}
    </div>
  );
}
