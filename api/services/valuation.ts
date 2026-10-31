/**
 * Intrinsic value models (4i, D41) — per docs/DESIGN_VALUE_SIGNALS.md.
 * NO point estimates of "fair price": outputs are ranges and market-
 * expectation reads. Everything computes from our own series + prices.
 */
import { getDb } from "../queries/connection";
import { sql } from "drizzle-orm";

/** DCF present value: 10y explicit FCF with linear growth fade to terminal g_inf, Gordon terminal. */
export function dcfValue(fcf0: number, g: number, gInf: number, wacc: number, years = 10): number {
  let pv = 0;
  let fcf = fcf0;
  for (let t = 1; t <= years; t++) {
    const fade = g + (gInf - g) * ((t - 1) / years); // linear fade toward gInf
    fcf = fcf * (1 + fade);
    pv += fcf / (1 + wacc) ** t;
  }
  const terminal = (fcf * (1 + gInf)) / (wacc - gInf);
  pv += terminal / (1 + wacc) ** years;
  return pv;
}

/**
 * Reverse DCF (Mauboussin/Rappaport "Expectations Investing"): the growth
 * rate that makes DCF = market value. Bisection on [−0.5, 1.0]; null when
 * the market price sits outside the model's reachable range.
 */
export function impliedGrowth(fcfTtm: number, marketValue: number, wacc: number, gInf = 0.025): number | null {
  if (fcfTtm <= 0 || marketValue <= 0 || wacc <= gInf) return null;
  let lo = -0.5, hi = 1.0;
  const f = (g: number) => dcfValue(fcfTtm, g, gInf, wacc) - marketValue;
  if (f(lo) > 0 || f(hi) < 0) return null; // unreachable range — honest null
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Residual income (EBO/Ohlson): V = B + Σ (ROE−r)·B_t/(1+r)^t + terminal.
 * Returns bear/base/bull from the ROE scenarios given (worst/median/best).
 */
export function residualIncome(bookEquity: number, roe: number, r: number, fadeYears = 10, terminalRoe?: number): number {
  let v = bookEquity;
  let b = bookEquity;
  const tRoe = terminalRoe ?? r; // default: competition fades ROE to the cost of equity
  for (let t = 1; t <= fadeYears; t++) {
    const roeT = roe + (tRoe - roe) * ((t - 1) / fadeYears);
    v += ((roeT - r) * b) / (1 + r) ** t;
    b = b * (1 + roeT * 0.5); // half of earnings retained (conservative payout)
  }
  return v;
}

/** Greenwald EPV: EBIT_TTM·(1−tax)/WACC, zero growth — the conservative floor. */
export function earningsPowerValue(ebitTtm: number, taxRate: number, wacc: number): number | null {
  if (wacc <= 0) return null;
  return (ebitTtm * (1 - taxRate)) / wacc;
}

/** z-score of x against a sample (multiples vs own history). */
export function zScore(x: number, sample: number[]): number | null {
  if (sample.length < 8) return null;
  const mean = sample.reduce((s, v) => s + v, 0) / sample.length;
  const sd = Math.sqrt(sample.reduce((s, v) => s + (v - mean) ** 2, 0) / (sample.length - 1));
  return sd > 0 ? (x - mean) / sd : null;
}

/** CAGR of a series (desc input). Positions carry TIME: nulls keep their
 *  slot (the span between the newest and oldest POSITIVE values is measured
 *  in original positions — filtering nulls would distort the time base). */
export function seriesCagr(valsDesc: (number | null)[], periodsPerYear: number): number | null {
  const firstIdx = valsDesc.findIndex((v) => v !== null && v > 0);
  let lastIdx = -1;
  for (let i = valsDesc.length - 1; i >= 0; i--) {
    const v = valsDesc[i];
    if (v !== null && v > 0) { lastIdx = i; break; }
  }
  if (firstIdx === -1 || lastIdx <= firstIdx) return null;
  const newest = valsDesc[firstIdx] as number;
  const oldest = valsDesc[lastIdx] as number;
  const years = (lastIdx - firstIdx) / periodsPerYear;
  if (years <= 0) return null;
  return (newest / oldest) ** (1 / years) - 1;
}

/** The per-company value read (D41). All inputs assembled in factors.ts' style. */
export async function computeCompanyValue(cik: number): Promise<{
  marketCap: number | null;
  price: number | null;
  impliedGrowthPct: number | null;
  fcfCagrPct: number | null;
  wacc: number | null;
  rim: { bear: number | null; base: number | null; bull: number | null } | null;
  epv: number | null;
  vpRatio: number | null;
  peZ: number | null;
}> {
  const db = getDb();
  const one = async (concept: string, kind: "flow" | "stock", limit = 40) => {
    const rows: any = await db.execute(sql`
      SELECT periodEnd, val FROM series_points
      WHERE cik=${cik} AND concept=${concept} AND kind=${kind} AND vintage='latest'
      ORDER BY periodEnd DESC LIMIT ${limit}`);
    return (rows[0] as any[]).map((r) => ({ periodEnd: String(r.periodEnd).slice(0, 10), val: r.val === null ? null : Number(r.val) }));
  };
  const ttmOf = (pts: { val: number | null }[]) => {
    const vals = pts.filter((p) => p.val !== null).slice(0, 4);
    return vals.length === 4 ? vals.reduce((s, p) => s + (p.val as number), 0) : null;
  };

  const { fundamentalsFromSeries, getBars, beta5y } = await import("./prices");
  const [cfoPts, capexPts, ebtPts, equityPts, epsPts, bars] = await Promise.all([
    one("NetCashProvidedByUsedInOperatingActivities", "flow"),
    one("PaymentsToAcquirePropertyPlantAndEquipment", "flow"),
    one("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "flow"),
    one("StockholdersEquity", "stock"),
    one("EarningsPerShareDiluted", "flow"),
    getBars(cik, new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10)),
  ]);

  const cfoTtm = ttmOf(cfoPts);
  const capexTtm = ttmOf(capexPts);
  const fcfTtm = cfoTtm !== null && capexTtm !== null ? cfoTtm - capexTtm : null;
  const ebitTtm = ttmOf(ebtPts);

  const { sharesDiluted, epsTtm } = await fundamentalsFromSeries(cik);
  const closes = bars.filter((b) => (b.adjClose ?? b.close) !== null);
  const price = closes.length ? (closes[closes.length - 1].adjClose ?? closes[closes.length - 1].close) : null;
  const marketCap = price !== null && sharesDiluted !== null ? price * sharesDiluted : null;

  // WACC-lite: rf 4% + beta5y × ERP 5% (constants until FRED feeds Stage 4)
  const beta = closes.length ? beta5y(bars, await getBars(0, new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10))) : null;
  const wacc = beta !== null ? 0.04 + beta * 0.05 : null;

  // FCF CAGR over period-aligned quarters (CFO and capex series lengths can
  // differ — align by periodEnd, never by array index)
  const capexByEnd = new Map(capexPts.filter((p) => p.val !== null).map((p) => [p.periodEnd, p.val as number]));
  const fcfSeries = cfoPts.map((p) =>
    p.val !== null && capexByEnd.has(p.periodEnd) ? p.val - capexByEnd.get(p.periodEnd)! : null
  );
  const fcfCagr = seriesCagr(fcfSeries, 4);

  const implied =
    fcfTtm !== null && marketCap !== null && wacc !== null ? impliedGrowth(fcfTtm, marketCap, wacc) : null;

  // RIM scenarios from the ROE history of the last 8 quarters
  const equityNow = equityPts.find((p) => p.val !== null)?.val ?? null;
  // NI approximated as EPS_TTM × diluted shares (dodges NI concept drift)
  const niApprox = epsTtm !== null && sharesDiluted !== null ? epsTtm * sharesDiluted : null;
  const roeNow = niApprox !== null && equityNow ? niApprox / equityNow : null;
  const rim =
    equityNow !== null && roeNow !== null && wacc !== null
      ? {
          bear: residualIncome(equityNow, Math.min(roeNow, wacc), wacc),
          base: residualIncome(equityNow, roeNow, wacc),
          bull: residualIncome(equityNow, roeNow * 1.25, wacc),
        }
      : null;

  const epv = ebitTtm !== null && wacc !== null ? earningsPowerValue(ebitTtm, 0.16, wacc) : null;

  // P/E z-score vs own history (monthly P/E from bars × trailing EPS series)
  let peZ: number | null = null;
  if (epsTtm !== null && epsTtm > 0 && price !== null) {
    const peNow = price / epsTtm;
    const monthly: number[] = [];
    const epsTtmByQuarter = new Map<string, number>();
    {
      const epsVals = epsPts.filter((p) => p.val !== null);
      for (let i = 0; i + 3 < epsVals.length; i++) {
        const t = epsVals.slice(i, i + 4).reduce((s, p) => s + (p.val as number), 0);
        epsTtmByQuarter.set(epsVals[i].periodEnd, t);
      }
    }
    const epsTimeline = [...epsTtmByQuarter.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const b of closes) {
      // trailing EPS TTM as of the bar date: the latest quarter end ≤ date
      let eps: number | null = null;
      for (const [pe, v] of epsTimeline) if (pe <= b.date) eps = v;
      const c = (b.adjClose ?? b.close) as number;
      if (eps && eps > 0 && c > 0) monthly.push(c / eps);
    }
    peZ = zScore(peNow, monthly);
  }

  return {
    marketCap,
    price,
    impliedGrowthPct: implied !== null ? implied * 100 : null,
    fcfCagrPct: fcfCagr !== null ? fcfCagr * 100 : null,
    wacc,
    rim,
    epv,
    vpRatio: rim && marketCap ? rim.base / marketCap : null,
    peZ,
  };
}
