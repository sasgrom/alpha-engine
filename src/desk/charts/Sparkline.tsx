/** A small trend line: the series in the de-emphasis gray, the latest point in the accent. */
export function Sparkline({ values, width = 96, height = 28, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const points = values.map((value, index) => [pad + (index / (values.length - 1)) * (width - pad * 2), pad + (1 - (value - min) / span) * (height - pad * 2)] as const);
  const path = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={path} fill="none" stroke="var(--d-axis-text)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill="var(--d-accent)" stroke="var(--d-surface)" strokeWidth={1.5} />
    </svg>
  );
}
