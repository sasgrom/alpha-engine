import type { DeskIntradayPoint } from "@contracts/intraday";
import { fmtClock, fmtPct } from "../format";

/** Today's path as a small line (returns from the previous close), for the watchlist rows and cards. */
export function IntradaySpark({ points, width = 110, height = 30, label }: { points: DeskIntradayPoint[]; width?: number; height?: number; label: string }) {
  if (points.length < 2) return <span className="desk-muted" style={{ fontSize: 11 }}>No session path</span>;
  const values = points.map(point => point.value), min = Math.min(...values), max = Math.max(...values), span = max - min || 1, pad = 3;
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const color = values.at(-1)! >= 0 ? "var(--d-up)" : "var(--d-down)";
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) => <circle key={point.time} cx={x(index)} cy={y(point.value)} r={4} fill="transparent"><title>{`${label} · ${fmtClock(point.time)} · ${fmtPct(point.value, 2)}`}</title></circle>)}
      <circle cx={x(points.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill={color}><title>{`${label} latest · ${fmtPct(values.at(-1)!, 2)}`}</title></circle>
    </svg>
  );
}
