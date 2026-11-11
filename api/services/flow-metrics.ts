export interface FlowMetrics {
  deltaShares: number;
  deltaSharesPct: number | null;
  deltaWeightPp: number | null;
}

/**
 * Share-based flow plus the change of the position's weight in the book, in percentage points:
 * (value now / book now − value before / book before) × 100. The weight needs dollar values; share counts
 * divided by a dollar book have no meaning, so without values the weight change is null.
 */
export function flowMetrics(curShares: number, prevShares: number, curBookUsd?: number | null, prevBookUsd?: number | null, curValueUsd?: number | null, prevValueUsd?: number | null): FlowMetrics {
  const deltaShares = curShares - prevShares;
  const deltaSharesPct = prevShares === 0 ? null : deltaShares / prevShares;
  let deltaWeightPp: number | null = null;
  if (curBookUsd && prevBookUsd && curBookUsd > 0 && prevBookUsd > 0 && Number.isFinite(curValueUsd) && Number.isFinite(prevValueUsd)) {
    deltaWeightPp = (curValueUsd! / curBookUsd - prevValueUsd! / prevBookUsd) * 100;
  }
  return { deltaShares, deltaSharesPct, deltaWeightPp };
}

export function shareFlowRatio(curShares: number, prevShares: number): number | null {
  return prevShares === 0 ? null : (curShares - prevShares) / prevShares;
}
