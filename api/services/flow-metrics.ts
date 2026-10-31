export interface FlowMetrics {
  deltaShares: number;
  deltaSharesPct: number | null;
  deltaWeightPp: number | null;
}

/** Share-based flow plus optional full-book portfolio-weight change in percentage points. */
export function flowMetrics(curShares: number, prevShares: number, curBookUsd?: number | null, prevBookUsd?: number | null): FlowMetrics {
  const deltaShares = curShares - prevShares;
  const deltaSharesPct = prevShares === 0 ? null : deltaShares / prevShares;
  let deltaWeightPp: number | null = null;
  if (curBookUsd && prevBookUsd && curBookUsd > 0 && prevBookUsd > 0) {
    deltaWeightPp = (curShares / curBookUsd - prevShares / prevBookUsd) * 100;
  }
  return { deltaShares, deltaSharesPct, deltaWeightPp };
}

export function shareFlowRatio(curShares: number, prevShares: number): number | null {
  return prevShares === 0 ? null : (curShares - prevShares) / prevShares;
}
