/** Deterministic matching and split-basis rules for the fund-book builder. */

export interface SecurityHistory {
  cusip: string;
  holders: Set<number>[];
  prices: (number | null)[];
}

export interface CompanyHistory extends SecurityHistory {
  company: number;
  factors: number[];
}

export interface QuarterPriceBasis {
  close: number | null;
  periodFactor: number | null;
  candidates: number[];
}

/** Standard as-traded closes and their split indexes, on the latest session's share basis. */
export function standardPriceHistory(csv: string, periods: string[]): QuarterPriceBasis[] | null {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (!header) return null;
  const columns = header.split(","), dateIndex = columns.indexOf("date"), closeIndex = columns.indexOf("close"), splitIndex = columns.indexOf("splitIndex");
  if (dateIndex < 0 || closeIndex < 0 || splitIndex < 0) throw new Error("The standard price CSV needs date, close and splitIndex columns");
  const rows = lines.map(line => {
    const fields = line.split(","), value = Number(fields[closeIndex]), index = Number(fields[splitIndex]);
    return { date: fields[dateIndex], close: value > 0 && Number.isFinite(value) ? value : null, splitIndex: index };
  }).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.splitIndex) && row.splitIndex > 0);
  if (!rows.length) return null;
  const today = rows[rows.length - 1].splitIndex;
  let cursor = 0;
  return periods.map(period => {
    while (cursor < rows.length && rows[cursor].date <= period) cursor++;
    const point = cursor ? rows[cursor - 1] : null;
    const close = point?.close && Date.parse(period) - Date.parse(point.date) <= 10 * 86_400_000 ? point.close : null;
    const candidates = [...new Set(rows.filter(row => row.date >= period).map(row => today / row.splitIndex))].sort((a, b) => a - b);
    return { close, periodFactor: point ? today / point.splitIndex : null, candidates };
  });
}

export interface SuccessorCandidate {
  company: number;
  predecessor: string;
  overlap: number;
  predecessorOverlap: number;
  priceRatio: number;
}

export interface SuccessorMatch extends SuccessorCandidate {
  cusip: string;
  firstQualifiedQuarter: number;
  t0: number;
  factors: number[];
}

export function nearestSplitProduct(value: number, candidates: number[], tolerance = Math.log(1.4)): { ratio: number; error: number } | null {
  if (!(value > 0) || !Number.isFinite(value) || !candidates.length) return null;
  let best: { ratio: number; error: number } | null = null;
  for (const candidate of candidates) {
    if (!(candidate > 0) || !Number.isFinite(candidate)) continue;
    const error = Math.abs(Math.log(value / candidate));
    if (!best || error < best.error || (error === best.error && candidate < best.ratio)) best = { ratio: candidate, error };
  }
  return best && best.error <= tolerance ? best : null;
}

export function positionBasis(
  shares: number,
  value: number,
  close: number | null,
  classFactor: number,
  periodFactor: number | null,
  candidates: number[],
): { factor: number | null; ratio: number | null; matched: boolean } {
  if (!(shares > 0 && value > 0 && close !== null && close > 0 && periodFactor !== null && periodFactor > 0)) return { factor: periodFactor, ratio: null, matched: false };
  const ratio = value / shares / ((close / periodFactor) * classFactor);
  const match = nearestSplitProduct(ratio, candidates.length ? candidates : [periodFactor]);
  return { factor: match?.ratio ?? periodFactor, ratio, matched: match !== null };
}

function successorAt(security: SecurityHistory, company: CompanyHistory, t0: number, minimumHolders: number): (SuccessorCandidate & { factors: number[] }) | null {
  const previous = company.holders[t0 - 1], current = company.holders[t0];
  if (!previous || previous.size < minimumHolders) return null;
  const before = previous.size, after = current?.size ?? 0;
  if (after * 2 > before) return null;
  const shared = [...security.holders[t0]].filter(fund => previous.has(fund)).length;
  const overlap = shared / security.holders[t0].size, predecessorOverlap = shared / before;
  if (overlap < 0.6 || predecessorOverlap < 0.8) return null;
  const close = company.prices[t0], price = security.prices[t0];
  if (close === null || price === null || close <= 0 || price <= 0) return null;
  const priceRatio = price / close;
  const candidatesAfter = [...new Set(company.factors.slice(t0))];
  if (!nearestSplitProduct(priceRatio, candidatesAfter, Math.log(1.02))) return null;
  return { company: company.company, predecessor: company.cusip, overlap, predecessorOverlap, priceRatio, factors: [...company.factors] };
}

export function findSuccessors(
  securities: SecurityHistory[],
  companies: CompanyHistory[] | ((t0: number) => CompanyHistory[]),
  minimumHolders = 3,
): { matches: SuccessorMatch[]; ambiguous: { cusip: string; t0: number; candidates: SuccessorCandidate[] }[] } {
  const matches: SuccessorMatch[] = [], ambiguous: { cusip: string; t0: number; candidates: SuccessorCandidate[] }[] = [];
  for (const security of securities) {
    const firstQualifiedQuarter = security.holders.findIndex(holders => holders.size >= minimumHolders);
    if (firstQualifiedQuarter < 1) continue;
    // Early adopters can cross the holder threshold before the actual succession. Use the first evidenced transition.
    for (let t0 = firstQualifiedQuarter; t0 < security.holders.length; t0++) {
      if (security.holders[t0].size < minimumHolders) continue;
      const histories = typeof companies === "function" ? companies(t0) : companies;
      const candidates = histories.map(company => successorAt(security, company, t0, minimumHolders)).filter(candidate => candidate !== null);
      if (candidates.length === 1) {
        matches.push({ ...candidates[0], cusip: security.cusip, firstQualifiedQuarter, t0 });
        break;
      }
      if (candidates.length > 1) {
        ambiguous.push({ cusip: security.cusip, t0, candidates: candidates.map(({ company, predecessor, overlap, predecessorOverlap, priceRatio }) => ({ company, predecessor, overlap, predecessorOverlap, priceRatio })) });
        break;
      }
    }
  }
  return { matches, ambiguous };
}
