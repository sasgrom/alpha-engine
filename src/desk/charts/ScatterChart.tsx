/**
 * One-series scatter with a nearest-point hover (the pointer only has to be closest, within 30px), ringed dots,
 * hairline grid and an optional y = x reference line. A few extreme points are labelled directly; every value is
 * also in the table under the chart.
 */
import { useMemo, useState, type PointerEvent } from "react";
import type { ChartPalette } from "./color";
import { linear, niceTicks, useWidth } from "./scale";

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
}

const MARGIN = { top: 14, right: 18, bottom: 40, left: 64 };

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  format,
  diagonalLabel,
  labelled = [],
  height = 340,
  palette,
  onOpen,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  format: (value: number) => string;
  diagonalLabel?: string;
  labelled?: string[];
  height?: number;
  palette: ChartPalette;
  onOpen?: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const layout = useMemo(() => {
    if (!points.length || width <= 0) return null;
    // each axis spans its own data, so the cloud uses the whole plot; the reference line is still drawn where y = x
    const span = (values: number[]): [number, number] => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pad = (max - min) * 0.08 || 0.01;
      return [Math.max(0, min - pad), max + pad];
    };
    const xDomain = span(points.map((point) => point.x));
    const yDomain = span(points.map((point) => point.y));
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const x = linear(xDomain, [MARGIN.left, MARGIN.left + plotW]);
    const y = linear(yDomain, [MARGIN.top + plotH, MARGIN.top]);
    const equal: [number, number] = [Math.max(xDomain[0], yDomain[0]), Math.min(xDomain[1], yDomain[1])];
    return { x, y, xTicks: niceTicks(xDomain[0], xDomain[1], 5), yTicks: niceTicks(yDomain[0], yDomain[1], 5), equal, plotW, plotH };
  }, [points, width, height]);

  if (!layout) return <div ref={ref} className="desk-chart" style={{ height }} />;
  const { x, y, xTicks, yTicks, equal, plotW, plotH } = layout;
  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = -1;
    let bestDistance = 30 * 30;
    points.forEach((point, index) => {
      const distance = (x(point.x) - px) ** 2 + (y(point.y) - py) ** 2;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best >= 0 ? best : null;
  };
  const active = hover === null ? null : points[hover];

  return (
    <div ref={ref} className="desk-chart" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${yLabel} against ${xLabel} for ${points.length} companies`}
        onPointerMove={(event) => setHover(nearest(event))}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const index = nearest(event as unknown as PointerEvent<SVGSVGElement>);
          if (index !== null) onOpen?.(points[index].id);
        }}
        style={{ cursor: active ? "pointer" : "default" }}
      >
        <g className="grid">
          {yTicks.map((tick) => <line key={`y${tick}`} x1={MARGIN.left} x2={MARGIN.left + plotW} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />)}
          {xTicks.map((tick) => <line key={`x${tick}`} x1={Math.round(x(tick)) + 0.5} x2={Math.round(x(tick)) + 0.5} y1={MARGIN.top} y2={MARGIN.top + plotH} />)}
        </g>
        <g className="axis">
          {yTicks.map((tick) => <text key={`y${tick}`} x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">{format(tick)}</text>)}
          {xTicks.map((tick) => <text key={`x${tick}`} x={x(tick)} y={MARGIN.top + plotH + 16} textAnchor="middle">{format(tick)}</text>)}
          <text x={MARGIN.left + plotW / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
          <text transform={`translate(14 ${MARGIN.top + plotH / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        </g>
        {diagonalLabel && equal[1] > equal[0] && (
          <g>
            <line x1={x(equal[0])} y1={y(equal[0])} x2={x(equal[1])} y2={y(equal[1])} stroke={palette.axis} strokeWidth={1} />
            <text className="desk-axis-text" x={x(equal[1]) - 6} y={y(equal[1]) + 14} textAnchor="end">{diagonalLabel}</text>
          </g>
        )}
        {points.map((point, index) => (
          <circle key={point.id} cx={x(point.x)} cy={y(point.y)} r={hover === index ? 6 : 4.5} fill={palette.accent} stroke={palette.surface} strokeWidth={2} />
        ))}
        {points.filter((point) => labelled.includes(point.id)).map((point) => (
          <text key={point.id} x={x(point.x) + 8} y={y(point.y) + 4} fontSize={11} fontWeight={600} fill={palette.ink}>{point.id}</text>
        ))}
      </svg>
      {active && (
        <div className="desk-tooltip" style={{ left: x(active.x) > width * 0.62 ? x(active.x) - 190 : x(active.x) + 14, top: Math.max(4, y(active.y) - 70) }}>
          <strong>{active.label}</strong>
          <div className="row"><span>{yLabel}</span><span>{format(active.y)}</span></div>
          <div className="row"><span>{xLabel}</span><span>{format(active.x)}</span></div>
        </div>
      )}
    </div>
  );
}
