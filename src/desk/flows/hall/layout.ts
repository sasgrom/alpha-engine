/**
 * Geometry of the rotunda in the fund-flow view: where every bookcase, book, fund and member of staff stands.
 * Pure functions, no rendering. The hall is a circle round the origin with the entrance at +z. An angle θ runs
 * clockwise seen from above, 0 at the far side: a point at radius r is (r·sin θ, y, −r·cos θ).
 */

export const ROTUNDA = {
  /** Face of the bookcases. */
  radius: 26,
  /** Half the opening of the entrance, in radians. */
  entranceHalf: 0.3,
  rows: 3,
  rowHeight: 1.3,
  shelfBase: 0.55,
  bookDepth: 0.8,
  bookGap: 0.04,
  /** Share of the wall outside the entrance taken by bookcases; the rest is piers between them. */
  alcoveShare: 0.62,
  /** Space at each end of a bookcase, in metres. */
  alcoveMargin: 0.5,
  galleryHeight: 7.6,
  wallTop: 15.5,
  domeHeight: 13,
  floorRadius: 27.4,
  /** The map table at the centre, the ring the staff keep round it, and the reading tables. */
  mapRadius: 5.2,
  staffRing: 6.6,
  /** People stand this far in front of the books, one row behind the other. */
  crowdFront: 2.4,
  crowdRowGap: 1.05,
  crowdSpacing: 0.95,
  /** Nobody stands closer to the centre than this (the staff ring and the map table). */
  crowdInner: 9.4,
} as const;

export interface HallCompany { cik: number; ticker: string; sector: string; held: number }

export interface Alcove {
  sector: string;
  /** Angles where the bookcase starts and ends, and its middle. */
  start: number;
  end: number;
  mid: number;
  /** Width along the wall, in metres. */
  width: number;
}

export interface HallBook {
  cik: number;
  ticker: string;
  sector: string;
  /** Angle of the book's centre, its shelf row (0 = lowest), and its centre in the hall. */
  angle: number;
  row: number;
  x: number;
  y: number;
  z: number;
  thickness: number;
  height: number;
}

export interface HallLayout {
  alcoves: Alcove[];
  books: HallBook[];
  /** Angle ranges between bookcases (piers carrying columns), the entrance excluded. */
  piers: { start: number; end: number }[];
}

export const TWO_PI = Math.PI * 2;

export function polar(angle: number, radius: number, y = 0): [number, number, number] {
  return [radius * Math.sin(angle), y, -radius * Math.cos(angle)];
}

/** The angle of a point in the hall, in the range (−π, π]. */
export function angleOf(x: number, z: number): number {
  return Math.atan2(x, -z);
}

/** Row order: the row at eye height first, then below, then above. */
const ROW_ORDER = [1, 0, 2];

/**
 * Bookcases and books. A sector's bookcase is as wide as its books need on three shelves; the books' thickness
 * follows the cube root of the value held (so their volume follows the money), scaled until all bookcases take
 * `alcoveShare` of the wall. The largest books stand in the middle of the eye-level shelf.
 */
export function hallLayout(companies: HallCompany[], sectorOrder: string[] = []): HallLayout {
  // only sectors with a bookcase: with an order given, the companies of sectors outside it (no sector) are left out
  const held = companies.filter((company) => company.held > 0 && (!sectorOrder.length || sectorOrder.includes(company.sector)));
  const bySector = new Map<string, HallCompany[]>();
  for (const company of held) (bySector.get(company.sector) ?? bySector.set(company.sector, []).get(company.sector)!).push(company);
  const rank = (sector: string) => {
    const index = sectorOrder.indexOf(sector);
    return index < 0 ? sectorOrder.length + 1 : index;
  };
  const sectors = [...bySector.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const { radius, entranceHalf, rows, bookGap, alcoveMargin } = ROTUNDA;
  const wall = radius * (TWO_PI - 2 * entranceHalf);
  const largest = Math.max(1, ...held.map((company) => company.held));
  const cube = (value: number) => Math.cbrt(value / largest);

  // thickness of the largest book that makes every bookcase fit its share of the wall
  const widthAt = (scale: number) => {
    let total = 0;
    for (const sector of sectors) {
      let run = 0;
      for (const company of bySector.get(sector)!) run += Math.max(0.12, Math.min(1.3, scale * cube(company.held))) + bookGap;
      total += (run / rows) * 1.08 + 2 * alcoveMargin;
    }
    return total;
  };
  let low = 0.05;
  let high = 4;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (widthAt(middle) > ROTUNDA.alcoveShare * wall) high = middle;
    else low = middle;
  }
  const scale = low;
  const thicknessOf = (company: HallCompany) => Math.max(0.12, Math.min(1.3, scale * cube(company.held)));

  // The first sector's bookcase faces the entrance across the hall; the next ones alternate to its right and its
  // left towards the entrance, piers spread evenly between them on each side.
  const widthOf = new Map(
    sectors.map((sector) => {
      let run = 0;
      for (const company of bySector.get(sector)!) run += thicknessOf(company) + bookGap;
      return [sector, (run / rows) * 1.08 + 2 * alcoveMargin];
    }),
  );
  const alcoves: Alcove[] = [];
  const piers: HallLayout["piers"] = [];
  const reach = Math.PI - entranceHalf;
  if (sectors.length) {
    const middle = widthOf.get(sectors[0])! / radius;
    alcoves.push({ sector: sectors[0], start: -middle / 2, end: middle / 2, mid: 0, width: widthOf.get(sectors[0])! });
    for (const side of [1, -1]) {
      const along = sectors.filter((_, index) => index > 0 && (index % 2 === 1) === (side === 1));
      const used = along.reduce((sum, sector) => sum + widthOf.get(sector)!, 0) / radius;
      const pier = Math.max(0, reach - middle / 2 - used) / (along.length + 1);
      let at = middle / 2;
      for (const sector of along) {
        const span = widthOf.get(sector)! / radius;
        const [p0, p1] = [at, at + pier];
        piers.push(side === 1 ? { start: p0, end: p1 } : { start: -p1, end: -p0 });
        const [a0, a1] = [at + pier, at + pier + span];
        alcoves.push(side === 1 ? { sector, start: a0, end: a1, mid: (a0 + a1) / 2, width: span * radius } : { sector, start: -a1, end: -a0, mid: -(a0 + a1) / 2, width: span * radius });
        at = a1;
      }
      piers.push(side === 1 ? { start: at, end: reach } : { start: -reach, end: -at });
    }
  } else piers.push({ start: -reach, end: reach });
  alcoves.sort((a, b) => a.start - b.start);
  piers.sort((a, b) => a.start - b.start);

  const books: HallBook[] = [];
  for (let index = 0; index < sectors.length; index++) {
    const alcove = alcoves[index];
    const list = [...bySector.get(alcove.sector)!].sort((a, b) => b.held - a.held || a.ticker.localeCompare(b.ticker));
    const inner = alcove.width - 2 * alcoveMargin;
    // fill the eye-level shelf from the middle outwards, then the one below, then the one above
    const shelves = ROW_ORDER.map((row) => ({ row, left: 0, right: 0 }));
    let current = 0;
    for (const company of list) {
      const thickness = thicknessOf(company);
      while (current < shelves.length - 1 && shelves[current].left + shelves[current].right + thickness + bookGap > inner) current++;
      const shelf = shelves[current];
      // the first book of a shelf takes the middle; then alternately to the right and to the left
      let offset: number;
      if (shelf.left === 0 && shelf.right === 0) {
        offset = 0;
        shelf.left = thickness / 2 + bookGap / 2;
        shelf.right = thickness / 2 + bookGap / 2;
      } else if (shelf.right <= shelf.left) {
        offset = shelf.right + thickness / 2;
        shelf.right += thickness + bookGap;
      } else {
        offset = -(shelf.left + thickness / 2);
        shelf.left += thickness + bookGap;
      }
      const angle = alcove.mid + offset / radius;
      const height = ROTUNDA.rowHeight * (0.56 + 0.36 * cube(company.held));
      const [x, , z] = polar(angle, radius + ROTUNDA.bookDepth / 2);
      books.push({ cik: company.cik, ticker: company.ticker, sector: alcove.sector, angle, row: shelf.row, x, y: ROTUNDA.shelfBase + shelf.row * ROTUNDA.rowHeight + height / 2, z, thickness, height });
    }
  }
  return { alcoves, books, piers };
}

export interface Slot { x: number; z: number; angle: number }

/**
 * The floor that belongs to each bookcase's crowd: from halfway to the bookcase on one side to halfway to the one on
 * the other, the outermost ones up to the entrance (keeping it clear).
 */
export function crowdWedges(alcoves: Pick<Alcove, "sector" | "mid">[]): Map<string, [number, number]> {
  const sorted = [...alcoves].sort((a, b) => a.mid - b.mid);
  const edge = Math.PI - ROTUNDA.entranceHalf - 0.12;
  return new Map(sorted.map((alcove, index) => [alcove.sector, [index > 0 ? (sorted[index - 1].mid + alcove.mid) / 2 : -edge, index < sorted.length - 1 ? (alcove.mid + sorted[index + 1].mid) / 2 : edge]]));
}

/**
 * Standing places for the crowd at a bookcase: the free places nearest the middle of the space in front of it, on
 * staggered rows parallel to the shelves, inside the bookcase's own wedge of the floor and clear of the ring round the
 * map table. The crowd grows as a cluster, wider than deep; one too large for its wedge spreads beyond it.
 */
export function crowdSlots(alcove: Pick<Alcove, "start" | "end" | "mid">, count: number, wedge?: [number, number]): Slot[] {
  const { radius, crowdFront, crowdRowGap, crowdSpacing, crowdInner } = ROTUNDA;
  const front = radius - crowdFront;
  let [low, high] = wedge ?? [alcove.start - 0.15, alcove.end + 0.15];
  for (let attempt = 0; ; attempt++) {
    const places: (Slot & { distance: number })[] = [];
    for (let row = 0; front - row * crowdRowGap >= crowdInner - 1e-9; row++) {
      const r = front - row * crowdRowGap;
      const step = crowdSpacing / r;
      // staggered rows look like a crowd, not a parade
      const shift = row % 2 ? step / 2 : 0;
      for (let k = Math.ceil((low - alcove.mid - shift) / step); k <= Math.floor((high - alcove.mid - shift) / step); k++) {
        const angle = alcove.mid + shift + k * step;
        const [x, , z] = polar(angle, r);
        // distance from the middle of the front row; depth counts a little more, so crowds hug their bookcase
        const along = (angle - alcove.mid) * r;
        const depth = (front - r) * 1.25;
        places.push({ x, z, angle, distance: along * along + depth * depth });
      }
    }
    if (places.length >= count || attempt >= 12) {
      places.sort((a, b) => a.distance - b.distance || a.angle - b.angle);
      return places.slice(0, count).map(({ x, z, angle }) => ({ x, z, angle }));
    }
    low -= 0.25;
    high += 0.25;
  }
}

/** Places round the map table for the library's staff (the index funds), spread evenly. */
export function staffSlots(count: number): Slot[] {
  const slots: Slot[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / Math.max(1, count)) * TWO_PI + 0.08;
    const [x, , z] = polar(angle, ROTUNDA.staffRing);
    slots.push({ x, z, angle });
  }
  return slots;
}

/**
 * A walk from one place to another round the hall rather than across the map table: the angle and the radius change
 * together, along the shorter way round, and the walk keeps outside the staff ring.
 */
export function walkPoint(from: Slot, to: Slot, t: number): [number, number] {
  const r0 = Math.hypot(from.x, from.z);
  const r1 = Math.hypot(to.x, to.z);
  let turn = to.angle - from.angle;
  while (turn > Math.PI) turn -= TWO_PI;
  while (turn < -Math.PI) turn += TWO_PI;
  const bulge = Math.sin(Math.PI * t) * Math.max(0, ROTUNDA.crowdInner + 0.8 - Math.min(r0, r1)) * (Math.abs(turn) > 0.6 ? 1 : 0);
  const radius = r0 + (r1 - r0) * t + bulge;
  const angle = from.angle + turn * t;
  return [radius * Math.sin(angle), -radius * Math.cos(angle)];
}

/** How far a walk goes, in metres (sampled). */
export function walkLength(from: Slot, to: Slot): number {
  let length = 0;
  let [px, pz] = walkPoint(from, to, 0);
  for (let step = 1; step <= 16; step++) {
    const [x, z] = walkPoint(from, to, step / 16);
    length += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return length;
}
