/**
 * One line of a statement period by period: thin bars from a shared zero line (a loss or an outflow hangs below it),
 * a hairline grid, a few axis labels, and a tooltip on the bar under the pointer with the change against the same
 * period a year earlier. A period without a figure leaves a gap. Every value is also in the table under the chart.
 */
import { useMemo, useState, type PointerEvent } from "react";
import type { ChartPalette } from "./color";
import { linear, niceTicks, useWidth } from "./scale";

export interface PeriodBar {
  key: string;
  /** Short axis label ("Q4 26", "FY 2026"). */
  label: string;
  /** Tooltip heading ("Quarter ended Sep 26, 2026"). */
  title: string;
  value: number | null;
}

const MARGIN = { top: 10, right: 8, bottom: 22 };

export function PeriodBars({
  bars,
  format,
  axisFormat,
  yearSteps,
  labelAt,
  labelAtEdge = false,
  name,
  height = 170,
  palette,
}: {
  bars: PeriodBar[];
  format: (value: number) => string;
  /** Axis labels, when they should be shorter than the tooltip's figure. */
  axisFormat?: (value: number) => string;
  /** How many bars back the same period a year earlier is (4 for quarters, 1 for years); 0 when the bars are not periods. */
  yearSteps: number;
  /** Which bars get an axis label; by default every one that fits, else every fourth counted from the newest. */
  labelAt?: (index: number) => boolean;
  /** Put a bar's label at its left edge instead of under its middle: for bars that are ranges of a scale, labelled by where they start. */
  labelAtEdge?: boolean;
  /** What the bars are, for assistive technology. */
  name: string;
  height?: number;
  palette: ChartPalette;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // a container not yet measured (or a test environment without layout) still draws at a sensible width
  const width = measured > 0 ? measured : 720;
  const layout = useMemo(() => {
    const values = bars.map((bar) => bar.value).filter((value): value is number => value !== null);
    if (!values.length) return null;
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
    const domain: [number, number] = [Math.min(ticks[0], 0, ...values), Math.max(ticks[ticks.length - 1], 0, ...values)];
    // the left margin fits the longest axis label ("−$100.0M" is wider than "50.0B")
    const left = Math.max(44, Math.max(...ticks.map((tick) => (axisFormat ?? format)(tick).length)) * 6.3 + 14);
    const plotW = width - left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const step = plotW / bars.length;
    return { ticks, y: linear(domain, [MARGIN.top + plotH, MARGIN.top]), step, bar: Math.max(2, Math.min(26, step - 2)), plotW, left };
  }, [bars, width, height, format, axisFormat]);

  if (!layout) return <div className="desk-empty" style={{ padding: "18px 0" }}>No figures to chart for this line.</div>;
  const { ticks, y, step, bar, plotW, left } = layout;
  const center = (index: number) => left + step * (index + 0.5);
  // every bar is labelled when they fit; otherwise every fourth, counted from the newest
  const every = step >= 44 ? 1 : 4;
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) * (width / (box.width || width)) - left) / step);
    setHover(index >= 0 && index < bars.length ? index : null);
  };
  const active = hover !== null ? bars[hover] : null;
  const before = hover !== null && yearSteps > 0 && hover >= yearSteps ? bars[hover - yearSteps].value : null;
  const change = active && active.value !== null && before !== null && before > 0 && active.value > 0 ? active.value / before - 1 : null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name}, ${bars.length} periods`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: "block", touchAction: "pan-y" }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? palette.axis : palette.grid} strokeWidth={1} />
            <text x={left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10.5} fill={palette.muted} style={{ fontVariantNumeric: "tabular-nums" }}>{(axisFormat ?? format)(tick)}</text>
          </g>
        ))}
        {bars.map((item, index) => {
          if (item.value === null) return null;
          const top = Math.min(y(item.value), y(0));
          const size = Math.max(1, Math.abs(y(item.value) - y(0)));
          return <rect key={item.key} data-bar={item.key} x={center(index) - bar / 2} y={top} width={bar} height={size} rx={Math.min(3, bar / 2, size / 2)} fill={palette.accent} opacity={hover === null || hover === index ? 1 : 0.55} />;
        })}
        {bars.map((item, index) => ((labelAt ? labelAt(index) : (bars.length - 1 - index) % every === 0) ? (
          <text key={item.key} x={center(index) - (labelAtEdge ? step / 2 : 0)} y={height - 6} textAnchor="middle" fontSize={10.5} fill={palette.muted}>{item.label}</text>
        ) : null))}
      </svg>
      {active && hover !== null && (
        <span className="desk-tooltip" style={{ top: 4, minWidth: 170, ...(center(hover) > width / 2 ? { right: `${((width - center(hover) + bar) / width) * 100}%` } : { left: `${((center(hover) + bar) / width) * 100}%` }) }}>
          <strong>{active.value === null ? "No figure" : format(active.value)}</strong>
          {active.title}
          {change !== null && <span className="row"><span>Against a year earlier</span><span>{`${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}%`}</span></span>}
        </span>
      )}
    </div>
  );
}
