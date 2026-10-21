/**
 * Factor library (4i, D41) — computed entirely from our own tables
 * (series_points + prices + events), per design memo docs/DESIGN_VALUE_SIGNALS.md.
 *
 * Pure functions are exported and unit-tested; computeCompanyFactors assembles
 * the per-company snapshot on demand (2–3-company scope per the owner's
 * credit discipline; the worker materializes batches later).
 *
 * Conventions: flow ratios use TTM sums over quarterly series; growth uses
 * fiscal-year aggregates (annual flows summed per fiscal year, stocks at the
 * FY-end quarter — the statements.ts convention). All factors are computed
 * on the LATEST vintage here; backtests must rebuild on as-of (D2).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { getBars, week52 } from "./prices";

// ---------------------------------------------------------------------------
// robust reference stats (4j): median + IQR band — gaps and extremes don't
// poison the company's own reference; sector means are a finals-phase TODO
// ---------------------------------------------------------------------------

/** Median of a numeric array (null when empty). */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolation quantile (type-7, like numpy's default). */
export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** The company's own robust reference band: median with p25/p75. */
export function robustBand(xs: number[]): { median: number; q25: number; q75: number } | null {
  const clean = xs.filter((x) => Number.isFinite(x));
  if (clean.length < 4) return null;
  const m = median(clean);
  const q25 = quantile(clean, 0.25);
  const q75 = quantile(clean, 0.75);
  return m === null || q25 === null || q75 === null ? null : { median: m, q25, q75 };
}

/** One factor's current value + history + robust band. */
export interface FactorDetail {
  value: number | null;
  history: { t: string; v: number }[];
  band: { median: number; q25: number; q75: number } | null;
}

// ---------------------------------------------------------------------------
// pure factor math (unit-tested)
// ---------------------------------------------------------------------------

/** Sloan 1996: accruals = (NI − CFO) / avg assets; lower is better. */
export function accruals(niTtm: number | null, cfoTtm: number | null, avgAssets: number | null): number | null {
  if (niTtm === null || cfoTtm === null || !avgAssets) return null;
  return (niTtm - cfoTtm) / avgAssets;
}

/** Novy-Marx 2013: gross profit TTM / assets. */
export function grossProfitability(gpTtm: number | null, assets: number | null): number | null {
  if (gpTtm === null || !assets) return null;
  return gpTtm / assets;
}

/** Cooper–Gulen–Schill 2008: asset growth YoY at FY ends. */
export function assetGrowth(assetsNow: number | null, assetsYearAgo: number | null): number | null {
  if (assetsNow === null || assetsYearAgo === null || assetsYearAgo === 0) return null;
  return assetsNow / assetsYearAgo - 1;
}

/** Buyback yield = −Δshares/shares + dividends/marketCap. */
export function buybackYield(sharesNow: number | null, sharesYearAgo: number | null, dividendsTtm: number | null, marketCap: number | null): number | null {
  if (marketCap === null || marketCap === 0) return null;
  let y = 0;
  if (sharesNow !== null && sharesYearAgo !== null && sharesYearAgo !== 0) y += -(sharesNow - sharesYearAgo) / sharesYearAgo;
  if (dividendsTtm !== null) y += Math.abs(dividendsTtm) / marketCap;
  return y;
}

/** Jegadeesh–Titman 12-2 momentum: cumulative return, skipping the last month. */
export function momentum122(bars: { date: string; close: number }[]): number | null {
  if (bars.length < 200) return null;
  const cutoff = bars.length - 22; // skip the last trading month
  if (cutoff < 1) return null;
  const first = bars[0].close;
  const last = bars[cutoff - 1].close;
  return first > 0 ? last / first - 1 : null;
}

/** George–Hwang 2004: proximity to the 52-week high (1 = at the high). */
export function high52Proximity(price: number | null, high52: number | null): number | null {
  if (price === null || !high52 || high52 <= 0) return null;
  return price / high52;
}

/** Chan–Jegadeesh–Lakonishok 1996 time-series SUE: (EPS_q − EPS_q-4)/σ of YoY diffs. */
export function sue(epsQuarterlyDesc: (number | null)[]): number | null {
  const vals = epsQuarterlyDesc.filter((x): x is number => x !== null);
  if (vals.length < 6) return null;
  const diffs: number[] = [];
  for (let i = 0; i + 4 < vals.length; i++) diffs.push(vals[i] - vals[i + 4]);
  if (diffs.length < 2) return null;
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1));
  return sd > 0 ? (vals[0] - vals[4]) / sd : null;
}

/** Piotroski 2000 F-score — nine binary signals over FY aggregates. */
export function piotroskiF(inp: {
  roaNow: number | null; roaPrev: number | null;
  cfoNow: number | null;
  accrualsNow: number | null; accrualsPrev: number | null;
  leverageNow: number | null; leveragePrev: number | null;
  currentNow: number | null; currentPrev: number | null;
  sharesNow: number | null; sharesPrev: number | null;
  gmNow: number | null; gmPrev: number | null;
  turnoverNow: number | null; turnoverPrev: number | null;
}): { score: number; signals: { key: string; pass: boolean | null }[] } {
  const sig = (key: string, v: boolean | null) => ({ key, pass: v });
  const gt = (a: number | null, b: number | null) => (a === null || b === null ? null : a > b);
  const lt = (a: number | null, b: number | null) => (a === null || b === null ? null : a < b);
  const signals = [
    sig("ROA > 0", inp.roaNow === null ? null : inp.roaNow > 0),
    sig("CFO > 0", inp.cfoNow === null ? null : inp.cfoNow > 0),
    sig("ΔROA > 0", gt(inp.roaNow, inp.roaPrev)),
    sig("accruals quality (CFO > ROA·A)", lt(inp.accrualsNow, inp.accrualsPrev) ?? null),
    sig("Δleverage < 0", lt(inp.leverageNow, inp.leveragePrev)),
    sig("Δcurrent ratio > 0", gt(inp.currentNow, inp.currentPrev)),
    sig("no share issuance", inp.sharesNow === null || inp.sharesPrev === null ? null : inp.sharesNow <= inp.sharesPrev * 1.005),
    sig("Δgross margin > 0", gt(inp.gmNow, inp.gmPrev)),
    sig("Δasset turnover > 0", gt(inp.turnoverNow, inp.turnoverPrev)),
  ];
  return { score: signals.filter((s) => s.pass === true).length, signals };
}

/** Altman 1968 Z-score (public-company variant). */
export function altmanZ(inp: {
  wc: number | null; retained: number | null; ebt: number | null;
  marketCap: number | null; liab: number | null; sales: number | null; assets: number | null;
}): number | null {
  const { wc, retained, ebt, marketCap, liab, sales, assets } = inp;
  if (!assets || !liab) return null;
  if (wc === null || retained === null || ebt === null || marketCap === null || sales === null) return null;
  return 1.2 * (wc / assets) + 1.4 * (retained / assets) + 3.3 * (ebt / assets) + 0.6 * (marketCap / liab) + 1.0 * (sales / assets);
}

/**
 * Beneish 1999 M-score — earnings-manipulation probability (M > −1.78 flags).
 * All eight components computable from our statement concepts.
 */
export function beneishM(inp: {
  arNow: number | null; arPrev: number | null; revNow: number | null; revPrev: number | null;
  gpNow: number | null; gpPrev: number | null;
  caNow: number | null; caPrev: number | null; ppeNow: number | null; ppePrev: number | null;
  assetsNow: number | null; assetsPrev: number | null;
  daNow: number | null; daPrev: number | null;
  sgaNow: number | null; sgaPrev: number | null;
  liabNow: number | null; liabPrev: number | null;
  niNow: number | null; cfoNow: number | null;
}): number | null {
  const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
  // AQI = (1 − (CA + PP&E)/TA) — asset quality; ratio of the two years
  const assetQuality = (ca: number | null, ppe: number | null, assets: number | null) =>
    assets === null || assets === 0 ? null : 1 - ((ca ?? 0) + (ppe ?? 0)) / assets;
  const dsr = ratio(ratio(inp.arNow, inp.revNow), ratio(inp.arPrev, inp.revPrev));
  const gmi = ratio(ratio(inp.gpPrev, inp.revPrev), ratio(inp.gpNow, inp.revNow));
  const aqi = ratio(
    assetQuality(inp.caNow, inp.ppeNow, inp.assetsNow),
    assetQuality(inp.caPrev, inp.ppePrev, inp.assetsPrev)
  );
  const sgi = ratio(inp.revNow, inp.revPrev);
  const depiNow = ratio(inp.daNow, (inp.ppeNow ?? 0) + (inp.daNow ?? 0));
  const depiPrev = ratio(inp.daPrev, (inp.ppePrev ?? 0) + (inp.daPrev ?? 0));
  const depi = ratio(depiPrev, depiNow);
  const sgai = ratio(ratio(inp.sgaNow, inp.revNow), ratio(inp.sgaPrev, inp.revPrev));
  const tata = ratio(inp.niNow !== null && inp.cfoNow !== null ? inp.niNow - inp.cfoNow : null, inp.assetsNow);
  const lvgi = ratio(ratio(inp.liabNow, inp.assetsNow), ratio(inp.liabPrev, inp.assetsPrev));
  if ([dsr, gmi, aqi, sgi, depi, sgai, tata, lvgi].some((x) => x === null)) return null;
  return (
    -4.84 + 0.92 * dsr! + 0.528 * gmi! + 0.404 * aqi! + 0.892 * sgi! + 0.115 * depi! - 0.172 * sgai! + 4.679 * tata! - 0.327 * lvgi!
  );
}

// ---------------------------------------------------------------------------
// assembler (DB → snapshot)
// ---------------------------------------------------------------------------

interface QPt { periodEnd: string; val: number | null }

/** latest-vintage quarterly series for one concept, desc by periodEnd. */
async function conceptSeries(cik: number, concept: string, kind: "flow" | "stock"): Promise<QPt[]> {
  const rows: any = await getDb().execute(sql`
    SELECT periodEnd, val FROM series_points
    WHERE cik=${cik} AND concept=${concept} AND kind=${kind} AND vintage='latest'
    ORDER BY periodEnd DESC LIMIT 60`);
  return (rows[0] as any[]).map((r) => ({ periodEnd: String(r.periodEnd).slice(0, 10), val: r.val === null ? null : Number(r.val) }));
}

const ttm = (pts: QPt[]): number | null => {
  const vals = pts.filter((p) => p.val !== null).slice(0, 4);
  return vals.length === 4 ? vals.reduce((s, p) => s + (p.val as number), 0) : null;
};
const latest = (pts: QPt[]): number | null => pts.find((p) => p.val !== null)?.val ?? null;
const yearAgo = (pts: QPt[]): number | null => pts.filter((p) => p.val !== null)[4]?.val ?? null;

/** The per-company factor snapshot (D41). nulls are honest "can't compute". */
export async function computeCompanyFactors(cik: number): Promise<{
  asOfQuarter: string | null;
  flowRatios: { accruals: number | null; grossProfitability: number | null };
  growth: { assetGrowthYoY: number | null; buybackYield: number | null };
  priceFactors: { momentum122: number | null; high52: number | null };
  sue: number | null;
  fScore: { score: number; signals: { key: string; pass: boolean | null }[] };
  altmanZ: number | null;
  beneishM: number | null;
  /** 4j: per-factor history + robust own-history band (wiki/reference layer) */
  detail: Record<"accruals" | "grossProfitability" | "assetGrowth" | "buybackYield" | "momentum122" | "high52" | "sue", FactorDetail>;
}> {
  const [ni, cfo, assets, gp, rev, liab, ca, cl, ar, ppe, da, sga, retained, ebt, shares, eps, div] =
    await Promise.all([
      conceptSeries(cik, "NetIncomeLoss", "flow"),
      conceptSeries(cik, "NetCashProvidedByUsedInOperatingActivities", "flow"),
      conceptSeries(cik, "Assets", "stock"),
      conceptSeries(cik, "GrossProfit", "flow"),
      conceptSeries(cik, "RevenueFromContractWithCustomerExcludingAssessedTax", "flow"),
      conceptSeries(cik, "Liabilities", "stock"),
      conceptSeries(cik, "AssetsCurrent", "stock"),
      conceptSeries(cik, "LiabilitiesCurrent", "stock"),
      conceptSeries(cik, "AccountsReceivableNetCurrent", "stock"),
      conceptSeries(cik, "PropertyPlantAndEquipmentNet", "stock"),
      conceptSeries(cik, "DepreciationDepletionAndAmortization", "flow"),
      conceptSeries(cik, "SellingGeneralAndAdministrativeExpense", "flow"),
      conceptSeries(cik, "RetainedEarningsAccumulatedDeficit", "stock"),
      conceptSeries(cik, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "flow"),
      conceptSeries(cik, "CommonStockSharesOutstanding", "stock"),
      conceptSeries(cik, "EarningsPerShareDiluted", "flow"),
      conceptSeries(cik, "PaymentsOfDividendsCommonStock", "flow"),
    ]);

  const niTtm = ttm(ni);
  const cfoTtm = ttm(cfo);
  const gpTtm = ttm(gp);
  const revTtm = ttm(rev);
  const assetsNow = latest(assets);
  const assetsPrev = yearAgo(assets);
  const avgAssets = assetsNow !== null && assetsPrev !== null ? (assetsNow + assetsPrev) / 2 : assetsNow;

  // price factors from our daily bars
  const from5y = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
  const bars = await getBars(cik, from5y);
  const closes = bars.filter((b) => (b.adjClose ?? b.close) !== null).map((b) => ({ date: b.date, close: (b.adjClose ?? b.close) as number }));
  const w52 = week52(bars);
  const priceNow = closes.length ? closes[closes.length - 1].close : null;
  const sharesNow = latest(shares);
  const marketCap = priceNow !== null && sharesNow !== null ? priceNow * sharesNow : null;

  // F-score inputs (latest FY vs prior FY ends)
  const roaNow = niTtm !== null && avgAssets ? niTtm / avgAssets : null;
  const roaPrevPts = ni.filter((p) => p.val !== null);
  const roaPrevTtm = roaPrevPts.length >= 8 ? roaPrevPts.slice(4, 8).reduce((s, p) => s + (p.val as number), 0) : null;
  const roaPrev = roaPrevTtm !== null && assetsPrev !== null ? roaPrevTtm / (avgAssets ?? assetsPrev) : null;
  const f = piotroskiF({
    roaNow,
    roaPrev,
    cfoNow: cfoTtm,
    accrualsNow: accruals(niTtm, cfoTtm, avgAssets),
    accrualsPrev: roaPrevTtm !== null ? accruals(roaPrevTtm, null, null) : null,
    leverageNow: liab.length && assetsNow ? (latest(liab) ?? 0) / assetsNow : null,
    leveragePrev: assetsPrev ? (yearAgo(liab) ?? 0) / assetsPrev : null,
    currentNow: latest(ca) !== null && latest(cl) ? (latest(ca) ?? 0) / (latest(cl) as number) : null,
    currentPrev: yearAgo(ca) !== null && yearAgo(cl) ? (yearAgo(ca) ?? 0) / (yearAgo(cl) as number) : null,
    sharesNow,
    sharesPrev: yearAgo(shares),
    gmNow: gpTtm !== null && revTtm ? gpTtm / revTtm : null,
    gmPrev: null, // honest null when the prior-year TTM isn't assemblable
    turnoverNow: revTtm !== null && avgAssets ? revTtm / avgAssets : null,
    turnoverPrev: null,
  });

  // --- 4j: per-period histories + robust own-history reference bands -------
  const byEndOf = (pts: QPt[]) => new Map(pts.filter((p) => p.val !== null).map((p) => [p.periodEnd, p.val as number]));
  const niM = byEndOf(ni);
  const cfoM = byEndOf(cfo);
  const assetsM = byEndOf(assets);
  const gpM = byEndOf(gp);
  const sharesM = byEndOf(shares);
  const epsM = byEndOf(eps);

  const mkHist = (fn: (e: string) => { t: string; v: number } | null, ends: string[]): { t: string; v: number }[] =>
    ends.map(fn).filter((x): x is { t: string; v: number } => x !== null && Number.isFinite(x.v));

  const assetEnds = [...assetsM.keys()].sort();
  const accrualsHist = mkHist((e) => {
    const a = assetsM.get(e);
    const n = niM.get(e);
    const c = cfoM.get(e);
    return a !== undefined && a !== 0 && n !== undefined && c !== undefined ? { t: e, v: (n - c) / a } : null;
  }, assetEnds);
  const gpHist = mkHist((e) => {
    const a = assetsM.get(e);
    const g = gpM.get(e);
    return a !== undefined && a !== 0 && g !== undefined ? { t: e, v: g / a } : null;
  }, assetEnds);
  const assetGrowthHist = mkHist((e) => {
    const i = assetEnds.indexOf(e);
    if (i < 4) return null;
    const prev = assetsM.get(assetEnds[i - 4]);
    const now = assetsM.get(e);
    return prev !== undefined && prev !== 0 && now !== undefined ? { t: e, v: now / prev - 1 } : null;
  }, assetEnds);
  // buyback history = the net-issuance part (share-count change YoY);
  // the dividend leg is stable and rides the threshold-0 reference instead
  const shareEnds = [...sharesM.keys()].sort();
  const buybackHist = mkHist((e) => {
    const i = shareEnds.indexOf(e);
    if (i < 4) return null;
    const prev = sharesM.get(shareEnds[i - 4]);
    const now = sharesM.get(e);
    return prev !== undefined && prev !== 0 && now !== undefined ? { t: e, v: -(now / prev - 1) } : null;
  }, shareEnds);
  const epsEndsDesc = [...epsM.keys()].sort().reverse();
  const epsValsDesc = epsEndsDesc.map((e) => epsM.get(e) as number);
  const sueHist = mkHist((e) => {
    const i = epsEndsDesc.indexOf(e);
    const v = sue(epsValsDesc.slice(i));
    return v !== null ? { t: e, v } : null;
  }, epsEndsDesc);
  // monthly price-factor histories over the last 5Y of closes
  const momentumHist: { t: string; v: number }[] = [];
  const high52Hist: { t: string; v: number }[] = [];
  for (let i = 252; i < closes.length; i += 21) {
    const slice = closes.slice(0, i + 1);
    const m = momentum122(slice);
    if (m !== null) momentumHist.push({ t: closes[i].date, v: m });
    const hi = Math.max(...slice.slice(-252).map((b) => b.close));
    if (hi > 0) high52Hist.push({ t: closes[i].date, v: closes[i].close / hi });
  }

  const detail = (value: number | null, history: { t: string; v: number }[]): FactorDetail => ({
    value,
    history,
    band: robustBand(history.map((h) => h.v)),
  });

  return {
    asOfQuarter: ni[0]?.periodEnd ?? assets[0]?.periodEnd ?? null,
    flowRatios: {
      accruals: accruals(niTtm, cfoTtm, avgAssets),
      grossProfitability: grossProfitability(gpTtm, assetsNow),
    },
    growth: {
      assetGrowthYoY: assetGrowth(assetsNow, assetsPrev),
      buybackYield: buybackYield(sharesNow, yearAgo(shares), ttm(div), marketCap),
    },
    priceFactors: {
      momentum122: momentum122(closes),
      high52: high52Proximity(priceNow, w52.high),
    },
    sue: sue(eps.filter((p) => p.val !== null).map((p) => p.val)),
    fScore: f,
    detail: {
      accruals: detail(accruals(niTtm, cfoTtm, avgAssets), accrualsHist),
      grossProfitability: detail(grossProfitability(gpTtm, assetsNow), gpHist),
      assetGrowth: detail(assetGrowth(assetsNow, assetsPrev), assetGrowthHist),
      buybackYield: detail(buybackYield(sharesNow, yearAgo(shares), ttm(div), marketCap), buybackHist),
      momentum122: detail(momentum122(closes), momentumHist),
      high52: detail(high52Proximity(priceNow, w52.high), high52Hist),
      sue: detail(sue(eps.filter((p) => p.val !== null).map((p) => p.val)), sueHist),
    },
    altmanZ: altmanZ({
      wc: latest(ca) !== null && latest(cl) !== null ? (latest(ca) as number) - (latest(cl) as number) : null,
      retained: latest(retained),
      ebt: ttm(ebt),
      marketCap,
      liab: latest(liab),
      sales: revTtm,
      assets: assetsNow,
    }),
    beneishM: beneishM({
      arNow: latest(ar), arPrev: yearAgo(ar),
      revNow: revTtm, revPrev: rev.filter((p) => p.val !== null).length >= 8 ? rev.filter((p) => p.val !== null).slice(4, 8).reduce((s, p) => s + (p.val as number), 0) : null,
      gpNow: gpTtm, gpPrev: gp.filter((p) => p.val !== null).length >= 8 ? gp.filter((p) => p.val !== null).slice(4, 8).reduce((s, p) => s + (p.val as number), 0) : null,
      caNow: latest(ca), caPrev: yearAgo(ca), ppeNow: latest(ppe), ppePrev: yearAgo(ppe),
      assetsNow, assetsPrev,
      daNow: ttm(da), daPrev: da.filter((p) => p.val !== null).length >= 8 ? da.filter((p) => p.val !== null).slice(4, 8).reduce((s, p) => s + (p.val as number), 0) : null,
      sgaNow: ttm(sga), sgaPrev: sga.filter((p) => p.val !== null).length >= 8 ? sga.filter((p) => p.val !== null).slice(4, 8).reduce((s, p) => s + (p.val as number), 0) : null,
      liabNow: latest(liab), liabPrev: yearAgo(liab),
      niNow: niTtm, cfoNow: cfoTtm,
    }),
  };
}
