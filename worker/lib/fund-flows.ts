/**
 * Pure computations behind the fund-flow view (contracts/fund-flows.ts): split-corrected flows between two
 * quarter-end 13F books, the estimated sector rotation, what followed the money, and the description of a fund
 * from its own record. The builder script does the reading; everything here is deterministic and unit-tested.
 */
import { FLOW_OUTSIDE, type FlowLink, type FlowOutcome, type FundCategory } from "../../contracts/fund-flows";

export interface Holding {
  fund: number;
  company: number;
  shares: number;
  value: number;
}

export interface PositionFlow {
  fund: number;
  company: number;
  /** Positive = bought, negative = sold, in dollars at the later quarter-end price. */
  usd: number;
  kind: "new" | "add" | "trim" | "exit";
}

// ---------------------------------------------------------------------------
// splits
// ---------------------------------------------------------------------------
/** A ratio close to a plausible split (n-for-1, 3-for-2, or a reverse 1-for-n) becomes that split; else 1. */
export function snapSplit(ratio: number, tolerance = 0.08): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  const forward = ratio >= 1 ? ratio : 1 / ratio;
  let best = 1;
  if (Math.abs(forward / 1.5 - 1) < tolerance / 2) best = 1.5;
  const whole = Math.round(forward);
  if (whole >= 2 && whole <= 60 && Math.abs(forward / whole - 1) < tolerance) best = whole;
  return ratio >= 1 ? best : 1 / best;
}

/**
 * Shares of the earlier quarter are multiplied by this to be comparable with the later quarter. The raw price
 * (value ÷ shares in the filings) falls by the split ratio while the split-adjusted close does not: the ratio of
 * the two moves is the split. Without adjusted closes a split cannot be told from a real move or sized (Amazon's
 * raw price fell 30-fold over the quarter of its 20-for-1 split), so an extreme raw move then returns null and
 * the company is left out of that pair of quarters.
 */
export function splitFactor(prevRaw: number | null, curRaw: number | null, prevAdjusted: number | null, curAdjusted: number | null): number | null {
  if (!prevRaw || !curRaw || prevRaw <= 0 || curRaw <= 0) return 1;
  const rawMove = curRaw / prevRaw;
  if (prevAdjusted && curAdjusted && prevAdjusted > 0 && curAdjusted > 0) return snapSplit(curAdjusted / prevAdjusted / rawMove);
  return rawMove < 0.3 || rawMove > 3.3 ? null : 1;
}

// ---------------------------------------------------------------------------
// flows
// ---------------------------------------------------------------------------
/** Value ÷ shares over all holders of a company: the quarter-end price the filings imply. */
export function impliedPrices(holdings: Holding[]): Map<number, number> {
  const sums = new Map<number, { shares: number; value: number }>();
  for (const row of holdings) {
    if (row.shares <= 0 || row.value <= 0) continue;
    const entry = sums.get(row.company) ?? { shares: 0, value: 0 };
    entry.shares += row.shares;
    entry.value += row.value;
    sums.set(row.company, entry);
  }
  return new Map([...sums].map(([company, entry]) => [company, entry.value / entry.shares]));
}

/**
 * Flows of the funds in `funds` between two quarter-end books. A position whose own price (value ÷ shares) is
 * more than three times off the company's implied price is a unit error in the filing and is left out, with the
 * count returned so it can be reported.
 */
export function positionFlows(
  previous: Holding[],
  current: Holding[],
  funds: Set<number>,
  factors: Map<number, number>,
  previousPrice: Map<number, number>,
  currentPrice: Map<number, number>,
): { flows: PositionFlow[]; suspect: number } {
  const key = (row: Holding) => `${row.fund}|${row.company}`;
  const sane = (row: Holding, price: number | undefined) => !price || row.shares <= 0 || (row.value / row.shares / price > 1 / 3 && row.value / row.shares / price < 3);
  const before = new Map<string, Holding>();
  const bad = new Set<string>();
  for (const row of previous) {
    if (!funds.has(row.fund)) continue;
    if (!sane(row, previousPrice.get(row.company))) bad.add(key(row));
    before.set(key(row), row);
  }
  const after = new Map<string, Holding>();
  for (const row of current) {
    if (!funds.has(row.fund)) continue;
    if (!sane(row, currentPrice.get(row.company))) bad.add(key(row));
    after.set(key(row), row);
  }
  const flows: PositionFlow[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (bad.has(id)) continue;
    const was = before.get(id);
    const now = after.get(id);
    const company = (now ?? was)!.company;
    const factor = factors.get(company) ?? 1;
    const earlier = (was?.shares ?? 0) * factor;
    const later = now?.shares ?? 0;
    const change = later - earlier;
    // rounding of a split leaves a share or two; less than 0.05% of the position is not a trade
    if (Math.abs(change) <= Math.max(1, 0.0005 * Math.max(earlier, later))) continue;
    const price = currentPrice.get(company) ?? (previousPrice.get(company) ? previousPrice.get(company)! / factor : null);
    if (!price) continue;
    flows.push({ fund: (now ?? was)!.fund, company, usd: change * price, kind: earlier === 0 ? "new" : later === 0 ? "exit" : change > 0 ? "add" : "trim" });
  }
  return { flows, suspect: bad.size };
}

/**
 * The ratio most of a set of ratios share: the median, when at least `share` of the values lie within `band` of
 * it. Null when there are fewer than `minimum` values or they are scattered.
 *
 * Trading scatters: funds buy and sell different amounts of a stock, and a fund changes its positions by different
 * amounts. When the share counts of nearly all holders of a company change by one factor, the company did
 * something to its shares (an exchange of shares, a split, a spin-off with a share consolidation); when nearly all
 * positions of a fund change by one factor, the fund changed what it reports.
 */
export function commonRatio(ratios: number[], minimum = 20, band = 0.02, share = 0.5): number | null {
  const usable = ratios.filter((ratio) => Number.isFinite(ratio) && ratio > 0);
  if (usable.length < minimum) return null;
  const middle = median(usable)!;
  const near = usable.filter((ratio) => Math.abs(ratio / middle - 1) <= band).length;
  return near / usable.length >= share ? middle : null;
}

/**
 * What a company did to its shares between two quarter ends, read from its holders: the factor by which an
 * unchanged holding's share count changed, or null for nothing. `ratios` are share counts now over before, one per
 * fund holding the company at both dates.
 *
 * In an ordinary quarter the middle holder's count hardly moves (index funds and long-term holders are most of
 * the list). So either most holders share one ratio away from 1, or the middle ratio itself is far from 1 while
 * the funds around it also traded (a spin-off with a share consolidation: every count halves, and many funds
 * adjust on top). A ratio within 1.5% of a clean split is that split.
 */
export function shareBasisChange(ratios: number[], minimum = 20): number | null {
  const usable = ratios.filter((ratio) => Number.isFinite(ratio) && ratio > 0);
  if (usable.length < minimum) return null;
  const common = commonRatio(usable, minimum);
  const middle = median(usable)!;
  const ratio = common !== null && Math.abs(common - 1) > 0.03 ? common : middle < 0.8 || middle > 1.25 ? middle : null;
  if (ratio === null) return null;
  const clean = snapSplit(ratio, 0.015);
  return clean !== 1 ? clean : ratio;
}

/**
 * A reporting change, not trading: most of a fund's positions moved the same way at once, or half of a broad book
 * appeared or vanished. Managers move holdings between the entities that file, absorb an acquired firm's accounts
 * or send in a quarter with part of the book missing, and that must not read as hundreds of billions bought or
 * sold. `previous` and `current` are one fund's positions; `factors` the share-basis changes of companies.
 *
 * "The same way at once" means at least 60% of the positions held at both dates grew, or at least 60% shrank, by
 * more than a step: 10% for a book of $50 billion or more, 50% for a smaller one (money pouring into a small fund
 * that buys everything in proportion can add a third in a quarter). A trading firm changes most of its positions
 * too, but in both directions; a fund that sells half of one large holding changes one position.
 */
export function reportingChange(previous: Holding[], current: Holding[], factors: Map<number, number> = new Map()): boolean {
  const before = new Map(previous.filter((row) => row.shares > 0).map((row) => [row.company, row]));
  const now = current.filter((row) => row.shares > 0);
  if (!before.size || !now.length) return true;
  const broad = Math.max(before.size, now.length) >= 100;
  if (broad && Math.min(before.size, now.length) / Math.max(before.size, now.length) < 0.5) return true;
  let value = 0;
  for (const row of before.values()) value += row.value;
  const step = value >= 50e9 ? 1.1 : 1.5;
  let held = 0;
  let grew = 0;
  let shrank = 0;
  for (const row of now) {
    const was = before.get(row.company);
    if (!was) continue;
    const ratio = row.shares / (was.shares * (factors.get(row.company) ?? 1));
    held++;
    if (ratio > step) grew++;
    else if (ratio < 1 / step) shrank++;
  }
  return held >= 20 && Math.max(grew, shrank) / held >= 0.6;
}

/**
 * One fund's estimated rotation: its sales paired with its own purchases in proportion. What it bought beyond its
 * sales came from outside the covered stocks; what it sold beyond its purchases left them.
 */
export function rotationLinks(sells: Map<string, number>, buys: Map<string, number>): FlowLink[] {
  const sold = [...sells.values()].reduce((sum, value) => sum + value, 0);
  const bought = [...buys.values()].reduce((sum, value) => sum + value, 0);
  const links: FlowLink[] = [];
  const paired = Math.min(sold, bought);
  if (paired > 0) {
    for (const [from, s] of sells) for (const [to, b] of buys) if (s > 0 && b > 0) links.push({ from, to, usd: (paired * s * b) / (sold * bought) });
  }
  if (bought > sold) for (const [to, b] of buys) if (b > 0) links.push({ from: FLOW_OUTSIDE, to, usd: ((bought - sold) * b) / bought });
  if (sold > bought) for (const [from, s] of sells) if (s > 0) links.push({ from, to: FLOW_OUTSIDE, usd: ((sold - bought) * s) / sold });
  return links;
}

export function addLinks(total: Map<string, number>, links: FlowLink[]): void {
  for (const link of links) total.set(`${link.from}|${link.to}`, (total.get(`${link.from}|${link.to}`) ?? 0) + link.usd);
}

export function linksFromTotals(total: Map<string, number>): FlowLink[] {
  return [...total]
    .map(([id, usd]) => ({ from: id.split("|")[0], to: id.split("|")[1], usd }))
    .filter((link) => link.usd > 0)
    .sort((a, b) => b.usd - a.usd);
}

// ---------------------------------------------------------------------------
// what followed
// ---------------------------------------------------------------------------
/** Dollar-weighted return of the dollars bought and of the dollars sold; items without a return are left out. */
export function flowOutcome(items: { usd: number; ret: number | null }[]): FlowOutcome {
  const side = (sign: 1 | -1) => {
    let weight = 0;
    let sum = 0;
    for (const item of items) {
      if (item.ret === null || Math.sign(item.usd) !== sign) continue;
      weight += Math.abs(item.usd);
      sum += Math.abs(item.usd) * item.ret;
    }
    return weight > 0 ? sum / weight : null;
  };
  const bought = side(1);
  const sold = side(-1);
  return { bought, sold, spread: bought !== null && sold !== null ? bought - sold : null };
}

/** Value-weighted return of a book over one period; null when under 90% of the value has a return. */
export function bookReturn(book: { value: number; ret: number | null }[]): number | null {
  let total = 0;
  let covered = 0;
  let sum = 0;
  for (const row of book) {
    if (row.value <= 0) continue;
    total += row.value;
    if (row.ret === null) continue;
    covered += row.value;
    sum += row.value * row.ret;
  }
  return total > 0 && covered / total >= 0.9 ? sum / covered : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Overlap of two books as the cosine of their weight vectors (1 = the same book, 0 = nothing in common). */
export function overlap(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (const value of a.values()) aa += value * value;
  for (const [company, value] of b) {
    bb += value * value;
    const other = a.get(company);
    if (other) dot += other * value;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

// ---------------------------------------------------------------------------
// describing a fund
// ---------------------------------------------------------------------------
export interface FundShape {
  tracked: number;
  book: number | null;
  positions: number;
  top10Share: number | null;
  effectivePositions: number | null;
  turnover: number | null;
  holdingYears: number | null;
  /** Largest lean toward and away from a sector against all funds, in weight points (fractions). */
  over: { sector: string; points: number } | null;
  under: { sector: string; points: number } | null;
}

export function bookShape(values: number[]): { top10Share: number | null; effectivePositions: number | null } {
  const positive = values.filter((value) => value > 0).sort((a, b) => b - a);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { top10Share: null, effectivePositions: null };
  const squares = positive.reduce((sum, value) => sum + (value / total) ** 2, 0);
  return { top10Share: positive.slice(0, 10).reduce((sum, value) => sum + value, 0) / total, effectivePositions: 1 / squares };
}

const PENSION = /RETIREMENT|PENSION|NORGES|NATIONAL BANK|TEMASEK|INVESTMENT BOARD|INVESTMENT CORP$|STATE OF |STATE BOARD|TEACHER|CAISSE|TREASURY|SUPER\b|FOUNDATION|COMMON FUND|STRS|KAPITALFORVALTNING|APG |PFA /i;
const BANK = /\bBANK|BANCORP|WELLS FARGO|MORGAN STANLEY|UBS|HSBC|NOMURA|INSURANCE|LIFE |MUTUAL AUTOMOBILE|LPL |WEALTH|TRUST CO|PRIVATE|AVIVA|PRINCIPAL FINANCIAL|ZURCHER|JULIUS BAER|SUMITOMO|MITSUBISHI/i;
const QUANT = /QUANT|TRADING|SUSQUEHANNA|CTC LLC|ARROWSTREET|PANAGORA|AQR|CAPITOLIS|HOLOCENE|WALLEYE|JANE STREET|HUDSON RIVER|VIRTU|OPTIVER|IMC |DRW|JUMP /i;

/**
 * Shelf of the catalog a fund stands on. A curated list wins; otherwise the stored tier and the name decide, and a
 * very broad, slow, market-like book is an index fund whatever it is called.
 */
export function fundCategory(name: string, tier: string | null, shape: Pick<FundShape, "positions" | "turnover" | "top10Share" | "tracked">, curated?: FundCategory): FundCategory {
  if (curated) return curated;
  if (tier === "quant" || QUANT.test(name)) return "quant";
  if (tier === "activist" || tier === "fundamental") return "hedge";
  if (PENSION.test(name)) return "pension";
  if (tier === "passive") return "index";
  if (shape.positions >= 300 && (shape.turnover ?? 1) <= 0.03 && (shape.top10Share ?? 1) <= 0.45 && shape.tracked >= 100e9) return "index";
  if (BANK.test(name)) return "bank";
  return "manager";
}

export function styleTags(shape: FundShape): string[] {
  const tags: string[] = [];
  if (shape.tracked >= 500e9) tags.push("Giant");
  if (shape.positions >= 300 && (shape.turnover ?? 1) <= 0.03 && (shape.top10Share ?? 1) <= 0.45) tags.push("Index-like");
  else if ((shape.top10Share ?? 0) >= 0.6 || shape.positions <= 25) tags.push("Concentrated");
  if (shape.turnover !== null && shape.turnover >= 0.2) tags.push("Fast trader");
  else if (shape.turnover !== null && shape.turnover <= 0.04) tags.push("Patient holder");
  if (shape.over && shape.over.points >= 0.12) tags.push(`${shape.over.sector} tilt`);
  return tags;
}

const usd = (value: number) => {
  const abs = Math.abs(value);
  const text = abs >= 1e12 ? `$${(abs / 1e12).toFixed(2)} trillion` : abs >= 1e9 ? `$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)} billion` : `$${(abs / 1e6).toFixed(0)} million`;
  return text;
};
const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const quarterLabel = (quarter: string) => `Q${Math.ceil(Number(quarter.slice(5, 7)) / 3)} ${quarter.slice(0, 4)}`;

export interface FundRecord {
  firstQuarter: string;
  latestQuarter: string;
  growth: number | null;
  growthAllFunds: number | null;
  realGrowth: number | null;
  tradeBought4: number | null;
  tradeSold4: number | null;
  latestNet: number | null;
  biggestBuy: string | null;
  biggestSale: string | null;
  /** Value of the covered shares underlying the options in the latest filing. */
  options?: { puts: number; calls: number } | null;
}

/** The fund in a few sentences, each one a statement of its own filings. */
export function fundStory(shape: FundShape, record: FundRecord): string[] {
  const story: string[] = [];
  story.push(
    `Holds ${usd(shape.tracked)} of the covered stocks in ${shape.positions} position${shape.positions === 1 ? "" : "s"}` +
      (shape.book && shape.book > shape.tracked * 1.05 ? `, out of a whole 13F book of ${usd(shape.book)}.` : "."),
  );
  if (shape.top10Share !== null) {
    const kind = shape.top10Share >= 0.6 ? "a concentrated book" : shape.top10Share <= 0.4 ? "spread wide, like an index" : "moderately concentrated";
    story.push(`Its ten largest positions are ${pct(shape.top10Share)} of that: ${kind}${shape.effectivePositions ? ` (it behaves like about ${Math.round(shape.effectivePositions)} equal positions)` : ""}.`);
  }
  if (shape.turnover !== null) {
    story.push(
      shape.turnover < 0.005
        ? "It hardly trades: less than half a percent of the book changes hands in a quarter."
        : `It trades about ${pct(shape.turnover, shape.turnover < 0.1 ? 1 : 0)} of the book a quarter${shape.holdingYears ? `, which works out to holding a typical position for roughly ${shape.holdingYears >= 10 ? "ten years or more" : `${shape.holdingYears.toFixed(shape.holdingYears < 2 ? 1 : 0)} year${shape.holdingYears >= 1.5 ? "s" : ""}`}` : ""}.`,
    );
  }
  if (record.options && shape.tracked > 0 && record.options.puts + record.options.calls >= 0.25 * shape.tracked) {
    story.push(
      `Beside the shares it reports options on the covered stocks: calls on ${usd(record.options.calls)} and puts on ${usd(record.options.puts)} of stock. ` +
        "Shares held against options are a hedge, so its share trades say little about what it expects.",
    );
  }
  if (shape.over && shape.under && (shape.over.points >= 0.03 || shape.under.points <= -0.03)) {
    story.push(`Against all tracked funds together it leans most toward ${shape.over.sector} (${(shape.over.points * 100).toFixed(0)} points more) and away from ${shape.under.sector} (${(-shape.under.points * 100).toFixed(0)} points less).`);
  }
  if (record.growth !== null) {
    story.push(
      `A dollar in its reported books in ${quarterLabel(record.firstQuarter)} was $${record.growth.toFixed(2)} by ${quarterLabel(record.latestQuarter)}` +
        (record.realGrowth !== null ? ` ($${record.realGrowth.toFixed(2)} after inflation)` : "") +
        (record.growthAllFunds !== null ? `; all tracked funds together: $${record.growthAllFunds.toFixed(2)}.` : "."),
    );
  }
  if (record.tradeBought4 !== null && record.tradeSold4 !== null) {
    const spread = record.tradeBought4 - record.tradeSold4;
    story.push(
      `Over the year after its trades, what it bought returned ${pct(record.tradeBought4, 0)} on average and what it sold ${pct(record.tradeSold4, 0)}: ` +
        (Math.abs(spread) < 0.01 ? "its trading made no measurable difference." : spread > 0 ? `its trading added about ${(spread * 100).toFixed(0)} points.` : `its trading cost about ${(-spread * 100).toFixed(0)} points.`),
    );
  }
  if (record.latestNet !== null && Math.abs(record.latestNet) > 0) {
    story.push(
      `In ${quarterLabel(record.latestQuarter)} it was a net ${record.latestNet >= 0 ? "buyer" : "seller"} of ${usd(record.latestNet)}` +
        (record.biggestBuy || record.biggestSale ? ` (largest purchase ${record.biggestBuy ?? "none"}, largest sale ${record.biggestSale ?? "none"}).` : "."),
    );
  }
  return story;
}
