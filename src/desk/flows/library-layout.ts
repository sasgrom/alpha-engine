/**
 * Where everything stands in the library of the fund-flow view. The hall runs along −z from the entrance at z = 0.
 * Sectors are bookcases along both walls; every covered company is a book whose thickness follows the value the
 * tracked funds hold; the funds are reading desks in the nave, shelved by kind. Pure geometry, no rendering.
 */
import { FUND_CATEGORY_LABEL, type FundCategory } from "@contracts/fund-flows";

export const HALL = {
  /** Distance from the centre line to the face of the bookcases. */
  aisle: 8.2,
  shelves: 7,
  shelfHeight: 1.22,
  shelfBase: 0.55,
  bookDepth: 0.72,
  bookGap: 0.03,
  bayGap: 1.8,
  /** Desk columns across the nave and the distance between desk rows. */
  deskColumns: [-5.25, -3.75, -2.25, -0.75, 0.75, 2.25, 3.75, 5.25],
  deskPitch: 1.05,
  entrance: 3,
} as const;

export const CATEGORY_ORDER: FundCategory[] = ["index", "manager", "hedge", "quant", "pension", "bank"];

export interface BayLayout {
  sector: string;
  side: -1 | 1;
  /** Extent along the hall as positive distances from the entrance. */
  from: number;
  to: number;
}

export interface BookLayout {
  cik: number;
  ticker: string;
  sector: string;
  side: -1 | 1;
  /** Centre of the book. */
  x: number;
  y: number;
  z: number;
  thickness: number;
  height: number;
}

export interface DeskLayout {
  cik: number;
  category: FundCategory;
  x: number;
  z: number;
  /** Width of the desk top. */
  size: number;
}

export interface LibraryLayout {
  bays: BayLayout[];
  books: BookLayout[];
  desks: DeskLayout[];
  /** Floor marks where each shelf of funds begins. */
  marks: { category: FundCategory; label: string; z: number }[];
  /** Length of the furnished hall; the way out stands a little beyond it. */
  length: number;
  top: number;
}

export interface LayoutCompany { cik: number; ticker: string; sector: string; held: number }
export interface LayoutFund { cik: number; category: FundCategory; tracked: number }

/** Shelf rows from the one at eye level outward, so the largest books of a sector stand where the eye lands. */
const ROW_ORDER = [3, 2, 4, 1, 5, 0, 6];

export function libraryLayout(companies: LayoutCompany[], funds: LayoutFund[]): LibraryLayout {
  const held = companies.filter((company) => company.held > 0);
  // A book grows in every direction with the cube root of the value held, so its volume is the money in it.
  const total = held.reduce((sum, company) => sum + Math.cbrt(company.held), 0) || 1;
  const largest = Math.max(1, ...held.map((company) => company.held));
  // about 31 units of shelf per wall and row; with few companies the largest book sets the scale instead
  const unit = Math.min((31 * 2 * HALL.shelves) / total, 2.6 / Math.cbrt(largest));
  const thicknessOf = (value: number) => Math.min(2.6, Math.max(0.16, Math.cbrt(value) * unit));

  const bySector = new Map<string, LayoutCompany[]>();
  for (const company of held) (bySector.get(company.sector) ?? bySector.set(company.sector, []).get(company.sector)!).push(company);
  const sectors = [...bySector].map(([sector, list]) => ({ sector, list: [...list].sort((a, b) => b.held - a.held), weight: list.reduce((sum, company) => sum + company.held, 0) })).sort((a, b) => b.weight - a.weight);

  const bays: BayLayout[] = [];
  const books: BookLayout[] = [];
  const reach: Record<string, number> = { "-1": HALL.entrance, "1": HALL.entrance };
  for (const { sector, list } of sectors) {
    const side: -1 | 1 = reach["-1"] <= reach["1"] ? -1 : 1;
    const run = list.reduce((sum, company) => sum + thicknessOf(company.held) + HALL.bookGap, 0);
    const width = Math.max(3.2, (run / HALL.shelves) * 1.08);
    const from = reach[String(side)];
    const rows = ROW_ORDER.map((row) => ({ row, used: 0 }));
    let current = 0;
    for (const company of list) {
      const thickness = thicknessOf(company.held);
      // the next row once this one is full; the last row takes what is left
      while (current < rows.length - 1 && rows[current].used + thickness > width) current++;
      const slot = rows[current];
      const height = HALL.shelfHeight * (0.56 + 0.36 * Math.cbrt(company.held / largest));
      books.push({
        cik: company.cik,
        ticker: company.ticker,
        sector,
        side,
        x: side * (HALL.aisle + HALL.bookDepth / 2),
        y: HALL.shelfBase + slot.row * HALL.shelfHeight + height / 2,
        z: -(from + slot.used + thickness / 2),
        thickness,
        height,
      });
      slot.used += thickness + HALL.bookGap;
    }
    const to = from + Math.max(width, ...rows.map((slot) => slot.used));
    bays.push({ sector, side, from, to });
    reach[String(side)] = to + HALL.bayGap;
  }
  const shelfEnd = Math.max(reach["-1"], reach["1"]) - HALL.bayGap;

  const desks: DeskLayout[] = [];
  const marks: LibraryLayout["marks"] = [];
  const most = Math.max(1, ...funds.map((fund) => fund.tracked));
  let row = 0;
  for (const category of CATEGORY_ORDER) {
    const members = funds.filter((fund) => fund.category === category).sort((a, b) => b.tracked - a.tracked);
    if (!members.length) continue;
    marks.push({ category, label: FUND_CATEGORY_LABEL[category], z: -(HALL.entrance + row * HALL.deskPitch - 0.2) });
    row += 0.8;
    members.forEach((fund, index) => {
      const column = index % HALL.deskColumns.length;
      if (index > 0 && column === 0) row++;
      desks.push({ cik: fund.cik, category, x: HALL.deskColumns[column], z: -(HALL.entrance + row * HALL.deskPitch), size: 0.46 + 0.9 * Math.sqrt(fund.tracked / most) });
    });
    row += 1.5;
  }
  const deskEnd = HALL.entrance + row * HALL.deskPitch;
  return { bays, books, desks, marks, length: Math.max(shelfEnd, deskEnd), top: HALL.shelfBase + HALL.shelves * HALL.shelfHeight };
}

/** A point on the arc from one place to another that rises to `lift` at its middle (a quadratic curve). */
export function arcPoint(from: [number, number, number], to: [number, number, number], lift: number, t: number): [number, number, number] {
  const mid: [number, number, number] = [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + lift, (from[2] + to[2]) / 2];
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * from[0] + b * mid[0] + c * to[0], a * from[1] + b * mid[1] + c * to[1], a * from[2] + b * mid[2] + c * to[2]];
}
