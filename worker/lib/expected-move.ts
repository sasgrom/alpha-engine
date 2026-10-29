import { entryCloseAfter, forwardReturnInfo } from "../../api/services/ic";
import type { VolBar } from "../../api/services/forward-volatility";

export function expectedMove(spot: number, iv: number, dteDays: number): number | null {
  if (![spot, iv, dteDays].every(Number.isFinite) || spot <= 0 || iv < 0 || dteDays <= 0) return null;
  return spot * iv * Math.sqrt(dteDays / 365);
}

export interface ExpectedMoveRow { date: string; expected: number; actual: number }
export function absoluteForwardMove(bars: VolBar[], anchorDate: string, horizon: number): { move: number; exitDate: string } | null {
  const entry = entryCloseAfter(bars, anchorDate), result = forwardReturnInfo(bars, anchorDate, horizon);
  if (!entry || !result) return null;
  // Expected move is in dollars, so the actual move must also be in dollars.
  return { move: Math.abs(result.ret) * entry.close, exitDate: result.exitDate };
}

export function summarizeExpectedMoves(rows: ExpectedMoveRow[]) {
  const valid = rows.filter((r) => Number.isFinite(r.expected) && r.expected > 0 && Number.isFinite(r.actual));
  if (!valid.length) return { n: 0, coverage: null, mae: null, rmse: null, medianRatio: null, meanRatio: null };
  const errors = valid.map((r) => r.actual - r.expected);
  const ratios = valid.map((r) => r.actual / r.expected).sort((a, b) => a - b);
  return {
    n: valid.length,
    coverage: valid.filter((r) => r.actual <= r.expected).length / valid.length,
    mae: errors.reduce((s, e) => s + Math.abs(e), 0) / valid.length,
    rmse: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / valid.length),
    medianRatio: ratios[Math.floor((ratios.length - 1) / 2)],
    meanRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
  };
}
