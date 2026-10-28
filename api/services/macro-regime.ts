export interface MacroPoint { date: string; value: number | null }

export function valueAtOrBefore(points: MacroPoint[], date: string): number | null {
  let value: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    if (p.value !== null) value = p.value;
  }
  return value;
}

export function vixRegime(v: number | null): "low" | "mid" | "high" | "unknown" {
  return v === null ? "unknown" : v < 20 ? "low" : v <= 28 ? "mid" : "high";
}
export function curveRegime(v: number | null): "normal" | "inversion" | "unknown" {
  return v === null ? "unknown" : v < 0 ? "inversion" : "normal";
}
export function hyRegime(v: number | null): "tight" | "mid" | "wide" | "unknown" {
  return v === null ? "unknown" : v < 4 ? "tight" : v <= 6 ? "mid" : "wide";
}
export function spyTrendRegime(bars: { date: string; close: number }[], date: string): "above200dma" | "below200dma" | "unknown" {
  const available = bars.filter((b) => b.date <= date);
  if (available.length < 200) return "unknown";
  const last = available[available.length - 1];
  const mean = available.slice(-200).reduce((s, b) => s + b.close, 0) / 200;
  return last.close >= mean ? "above200dma" : "below200dma";
}

/** Deterministic independent-universe split, stable across runs. */
export function splitByCikParity(ciks: number[]): { odd: number[]; even: number[] } {
  const odd = [...ciks].sort((a, b) => a - b).filter((_, i) => i % 2 === 0);
  const even = [...ciks].sort((a, b) => a - b).filter((_, i) => i % 2 === 1);
  return { odd, even };
}
