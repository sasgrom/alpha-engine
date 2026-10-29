import { forwardReturnInfo } from "../../api/services/ic";
import type { VolBar } from "../../api/services/forward-volatility";

export function expectedMove(spot: number, iv: number, dteDays: number): number | null {
  if (![spot, iv, dteDays].every(Number.isFinite) || spot <= 0 || iv < 0 || dteDays <= 0) return null;
  return spot * iv * Math.sqrt(dteDays / 365);
}

export interface ExpectedMoveRow { date: string; expected: number; actual: number }
export function absoluteForwardMove(bars: VolBar[], anchorDate: string, horizon: number): { move: number; exitDate: string } | null {
  const result = forwardReturnInfo(bars, anchorDate, horizon);
  return result ? { move: Math.abs(result.ret), exitDate: result.exitDate } : null;
}

export function summarizeExpectedMoves(rows: ExpectedMoveRow[]) {
  if (!rows.length) return { n: 0, coverage: null, mae: null, rmse: null, medianRatio: null, meanRatio: null };
  const errors = rows.map((r) => r.actual - r.expected);
  const ratios = rows.map((r) => r.actual / r.expected).sort((a, b) => a - b);
  return {
    n: rows.length,
    coverage: rows.filter((r) => r.actual <= r.expected).length / rows.length,
    mae: errors.reduce((s, e) => s + Math.abs(e), 0) / rows.length,
    rmse: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / rows.length),
    medianRatio: ratios[Math.floor((ratios.length - 1) / 2)],
    meanRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
  };
}
