/**
 * 6c — logistic candidate with partial pooling + isotonic calibration +
 * block-bootstrap CIs. Pure, unit-tested (no DB).
 */

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Ridge logistic regression via IRLS (Newton). Coefficients only; intercept handled by caller. */
export function fitLogisticRidge(X: number[][], y: number[], lambda = 1, maxIter = 50): number[] {
  const n = X.length;
  if (n === 0) return [];
  if (y.length !== n || X.some((row) => row.length !== X[0].length || row.some((v) => !Number.isFinite(v)))) {
    throw new Error("fitLogisticRidge: invalid feature matrix");
  }
  const m = X[0].length;
  if (m === 0) return [];
  let b = new Array(m).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const p = X.map((row) => sigmoid(row.reduce((a, v, j) => a + v * b[j], 0)));
    const W = p.map((pi) => Math.max(pi * (1 - pi), 1e-6));
    const Z = X.map((row, i) => row.reduce((a, v, j) => a + v * b[j], 0) + (y[i] - p[i]) / W[i]);
    // solve (X^T W X + λI) b_new = X^T W z
    const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) A[j][k] += W[i] * X[i][j] * X[i][k];
    }
    for (let j = 0; j < m; j++) A[j][j] += lambda;
    const rhs = X.map((_, j) => X.reduce((a, row, i) => a + row[j] * W[i] * Z[i], 0));
    const bNew = solve(A, rhs);
    const delta = Math.max(...bNew.map((v, j) => Math.abs(v - b[j])));
    b = bNew;
    if (delta < 1e-6) break;
  }
  return b;
}

/** Symmetric linear solver (Gaussian elimination with partial pivot). */
export function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Intercept-only refit on one company's rows, then shrink toward the global intercept. */
export function partialPooledIntercept(
  globalIntercept: number,
  companyIntercept: number,
  companyN: number,
  tau = 8
): number {
  const w = companyN / (companyN + tau);
  return w * companyIntercept + (1 - w) * globalIntercept;
}

/** Isotonic regression via pool-adjacent-violators on (p, realizedUp). */
export function isotonicFit(points: { p: number; y: number }[]): (p: number) => number {
  const clean = points.filter((p) => Number.isFinite(p.p) && Number.isFinite(p.y));
  if (clean.length < 8) return (p) => p; // honest identity when too few to calibrate
  const sorted = [...clean].sort((a, b) => a.p - b.p);
  // Average ties first: two observations at the same score must not become two
  // arbitrary calibration steps whose order depends on the input sort.
  const tied: { sumX: number; sumY: number; n: number; meanX: number; meanY: number }[] = [];
  for (const pt of sorted) {
    const last = tied[tied.length - 1];
    if (last && pt.p === last.meanX) {
      last.sumX += pt.p; last.sumY += pt.y; last.n++;
      last.meanX = last.sumX / last.n; last.meanY = last.sumY / last.n;
    } else {
      tied.push({ sumX: pt.p, sumY: pt.y, n: 1, meanX: pt.p, meanY: pt.y });
    }
  }
  const blocks: typeof tied = [];
  for (const block of tied) {
    blocks.push({ ...block });
    while (blocks.length >= 2 && blocks[blocks.length - 2].meanY > blocks[blocks.length - 1].meanY) {
      const right = blocks.pop()!, left = blocks.pop()!;
      const sumX = left.sumX + right.sumX, sumY = left.sumY + right.sumY, n = left.n + right.n;
      blocks.push({ sumX, sumY, n, meanX: sumX / n, meanY: sumY / n });
    }
  }
  return (p: number) => {
    if (!Number.isFinite(p) || blocks.length === 0) return p;
    if (p <= blocks[0].meanX) return Math.max(0, Math.min(1, blocks[0].meanY));
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1], b = blocks[i];
      if (p <= b.meanX) {
        const span = b.meanX - a.meanX;
        const w = span <= 0 ? 1 : (p - a.meanX) / span;
        return Math.max(0, Math.min(1, a.meanY + w * (b.meanY - a.meanY)));
      }
    }
    return Math.max(0, Math.min(1, blocks[blocks.length - 1].meanY));
  };
}

/** Block-bootstrap accuracy CI (5–95%) preserving anchor order blocks. */
export function blockBootstrapAccuracyCI(
  points: { correct: boolean }[],
  iterations = 400,
  blockSize = 8
): { low: number; high: number } {
  const n = points.length;
  if (n === 0) return { low: 0, high: 0 };
  const size = Math.max(1, Math.min(blockSize, n));
  const blocks: boolean[][] = [];
  for (let i = 0; i < n; i += size) blocks.push(points.slice(i, i + size).map((p) => p.correct));
  const rates: number[] = [];
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let it = 0; it < iterations; it++) {
    const sample: boolean[] = [];
    while (sample.length < n) sample.push(...blocks[Math.floor(rand() * blocks.length)]);
    sample.length = n;
    rates.push(sample.filter(Boolean).length / n);
  }
  rates.sort((a, b) => a - b);
  return { low: rates[Math.floor(rates.length * 0.05)], high: rates[Math.floor(rates.length * 0.95)] };
}

/**
 * Cost-adjusted metrics. With `position` (0 = cash/benchmark, 1 = long), the
 * return is position×asset excess return and turnover is |new−old|, including
 * initial entry. The legacy `positionChanged` shape remains supported for
 * callers that already supply strategy returns. Equity and drawdown compound
 * period returns. Sharpe is per anchor, not annualized (anchors are not assumed
 * evenly spaced); callers must supply non-overlapping windows for performance.
 */
export function costMetrics(
  series: { ret: number; positionChanged?: boolean; position?: number }[],
  opts: { commissionBps?: number; slippageBps?: number; initialPosition?: number } = {}
): { turnover: number; cost: number; sharpe: number | null; maxDD: number; totalReturn: number; meanReturn: number; n: number } {
  const commission = (opts.commissionBps ?? 5) / 10000;
  const slippage = (opts.slippageBps ?? 10) / 10000;
  const rate = commission + slippage;
  const positioned = series.some((s) => s.position !== undefined);
  let turnover = 0, cost = 0, equity = 1, peak = 1, maxDD = 0;
  let previous = opts.initialPosition ?? 0;
  const rets: number[] = [];
  for (const s of series) {
    let r: number;
    if (positioned) {
      const position = s.position ?? 0;
      const changed = Math.abs(position - previous);
      turnover += changed;
      cost += changed * rate;
      r = position * s.ret - changed * rate;
      previous = position;
    } else {
      const changed = s.positionChanged ? 1 : 0;
      turnover += changed;
      cost += changed * rate;
      r = s.ret - changed * rate;
    }
    rets.push(r);
    equity *= Math.max(0, 1 + r);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak === 0 ? 0 : 1 - equity / peak);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(rets.length, 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(rets.length - 1, 1));
  return { turnover, cost, sharpe: sd === 0 ? null : mean / sd, maxDD, totalReturn: equity - 1, meanReturn: mean, n: rets.length };
}
