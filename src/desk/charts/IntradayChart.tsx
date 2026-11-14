import type { DeskIntradayMarker, DeskIntradayPoint } from "@contracts/intraday";
import { fmtClock, fmtCompact, fmtPct, fmtPrice } from "../format";

export interface IntradayChartSeries {
  name: string;
  color?: string;
  points: DeskIntradayPoint[];
}

interface LineChartProps {
  label: string;
  series: IntradayChartSeries[];
  previousClose?: number | null;
  baseline?: number | null;
  markers?: DeskIntradayMarker[];
  valueKind?: "price" | "percent";
  height?: number;
}

export function IntradayLineChart({ label, series, previousClose = null, baseline = null, markers = [], valueKind = "percent", height = 220 }: LineChartProps) {
  const width = 720, left = 48, right = 14, top = 14, bottom = 28, innerWidth = width - left - right, innerHeight = height - top - bottom;
  const format = (value: number) => valueKind === "price" ? fmtPrice(value) : fmtPct(value, 2);
  const values = series.flatMap(row => row.points.map(point => point.value));
  for (const value of [previousClose, baseline]) if (value !== null) values.push(value);
  const times = series.flatMap(row => row.points.map(point => Date.parse(point.time))).filter(Number.isFinite);
  for (const marker of markers) if (marker.time) times.push(Date.parse(marker.time));
  if (!values.length || !times.length) return <div className="desk-empty">No price path is stored for this session.</div>;
  let min = Math.min(...values), max = Math.max(...values);
  const padding = (max - min || Math.max(Math.abs(max) * 0.02, valueKind === "price" ? 0.01 : 0.001)) * 0.3;
  min -= padding;
  max += padding;
  const start = Math.min(...times), end = Math.max(...times), span = Math.max(end - start, 60_000);
  const x = (time: string) => left + ((Date.parse(time) - start) / span) * innerWidth;
  const y = (value: number) => top + (1 - (value - min) / (max - min)) * innerHeight;
  const gridValues = [min + padding, (min + max) / 2, max - padding];
  const tickTimes = [...new Set([start, Math.round((start + end) / 2), end])];
  return (
    <svg className="desk-intraday-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {gridValues.map((value, index) => <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--d-border)" strokeDasharray="3 5" /><text x={left - 7} y={y(value) + 3} textAnchor="end" fill="var(--d-axis-text)" fontSize={10}>{format(value)}</text></g>)}
      {previousClose !== null && <line x1={left} x2={width - right} y1={y(previousClose)} y2={y(previousClose)} stroke="var(--d-muted)" strokeDasharray="6 4"><title>Previous close · {format(previousClose)}</title></line>}
      {baseline !== null && <line x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} stroke="var(--d-muted)" strokeDasharray="2 5"><title>Baseline · {format(baseline)}</title></line>}
      {series.map((row, rowIndex) => {
        const color = row.color ?? ["var(--d-accent)", "var(--d-axis-text)", "var(--d-pos)", "var(--d-neg)"][rowIndex % 4];
        const path = row.points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
        return <g key={row.name}>
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {row.points.map(point => <circle key={`${row.name}-${point.time}`} cx={x(point.time)} cy={y(point.value)} r={5} fill="transparent" tabIndex={0} aria-label={`${row.name}, ${fmtClock(point.time)}, ${format(point.value)}`}><title>{`${row.name} · ${fmtClock(point.time)} · ${format(point.value)}`}</title></circle>)}
          {row.points.length > 0 && <circle cx={x(row.points.at(-1)!.time)} cy={y(row.points.at(-1)!.value)} r={3.2} fill={color}><title>{`${row.name} latest · ${fmtClock(row.points.at(-1)!.time)} · ${format(row.points.at(-1)!.value)}`}</title></circle>}
        </g>;
      })}
      {markers.map((marker, index) => {
        const markerX = marker.time ? x(marker.time) : left + innerWidth / 2;
        const tooltip = `${marker.label} · ${marker.time ? fmtClock(marker.time) : "time not stored"}`;
        return <g key={`${marker.accessionNo ?? marker.label}-${index}`}><line x1={markerX} x2={markerX} y1={top} y2={height - bottom} stroke="var(--d-warning)" strokeDasharray="2 3"><title>{tooltip}</title></line><circle cx={markerX} cy={top + 4} r={4} fill="var(--d-warning)" tabIndex={0} aria-label={tooltip}><title>{tooltip}</title></circle></g>;
      })}
      {tickTimes.map(time => <text key={time} x={left + ((time - start) / span) * innerWidth} y={height - 7} textAnchor="middle" fill="var(--d-axis-text)" fontSize={10}>{fmtClock(new Date(time).toISOString())}</text>)}
    </svg>
  );
}

export function IntradayVolumeChart({ bars, label }: { bars: { end: string; v: number | null }[]; label: string }) {
  const measured = bars.filter(bar => bar.v !== null);
  if (!measured.length) return <div className="desk-empty">No snapshot volume is stored.</div>;
  const width = 720, height = 74, max = Math.max(...measured.map(bar => bar.v!), 1), step = width / measured.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {measured.map((bar, index) => {
        const barHeight = Math.max(1, (bar.v! / max) * (height - 16));
        return <rect key={bar.end} x={index * step + 1} y={height - 12 - barHeight} width={Math.max(1, step - 2)} height={barHeight} fill="var(--d-accent)" opacity={0.55}><title>{`${fmtClock(bar.end)} · ${fmtCompact(bar.v)} shares`}</title></rect>;
      })}
      <text x={2} y={height - 1} fill="var(--d-axis-text)" fontSize={10}>Volume · up to {fmtCompact(max)} shares per snapshot</text>
    </svg>
  );
}

export function IntradaySpark({ points, width = 110, height = 30, label }: { points: DeskIntradayPoint[]; width?: number; height?: number; label: string }) {
  if (points.length < 2) return <span className="desk-muted" style={{ fontSize: 11 }}>No session path</span>;
  const values = points.map(point => point.value), min = Math.min(...values), max = Math.max(...values), span = max - min || 1, pad = 3;
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const color = values.at(-1)! >= 0 ? "var(--d-pos)" : "var(--d-neg)";
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) => <circle key={point.time} cx={x(index)} cy={y(point.value)} r={4} fill="transparent"><title>{`${label} · ${fmtClock(point.time)} · ${fmtPct(point.value, 2)}`}</title></circle>)}
      <circle cx={x(points.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill={color}><title>{`${label} latest · ${fmtPct(values.at(-1)!, 2)}`}</title></circle>
    </svg>
  );
}
