export interface RequestInterval { start: number; end: number }

/** Wall time covered by at least one Ollama request, without double-counting
 * overlap when two lanes are active. Gaps = stage wall time minus this union. */
export function unionDurationMs(intervals: RequestInterval[]): number {
  const sorted = intervals.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return 0;
  let total = 0, start = sorted[0].start, end = sorted[0].end;
  for (const x of sorted.slice(1)) {
    if (x.start > end) {
      total += end - start;
      start = x.start;
      end = x.end;
    } else {
      end = Math.max(end, x.end);
    }
  }
  return total + end - start;
}
