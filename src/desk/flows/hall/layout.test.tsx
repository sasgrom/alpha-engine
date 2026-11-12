import { describe, expect, it } from "vitest";
import { angleOf, crowdSlots, crowdWedges, hallLayout, polar, ROTUNDA, staffSlots, TWO_PI, walkLength, walkPoint } from "./layout";

const sectors = ["Information Technology", "Financials", "Energy"];
const companies = [
  ...Array.from({ length: 70 }, (_, index) => ({ cik: 1000 + index, ticker: `T${index}`, sector: "Information Technology", held: 2e12 / (index + 1) })),
  ...Array.from({ length: 40 }, (_, index) => ({ cik: 2000 + index, ticker: `F${index}`, sector: "Financials", held: 6e11 / (index + 1) })),
  ...Array.from({ length: 20 }, (_, index) => ({ cik: 3000 + index, ticker: `E${index}`, sector: "Energy", held: 3e11 / (index + 1) })),
  { cik: 9, ticker: "NONE", sector: "Energy", held: 0 },
];

describe("the rotunda", () => {
  const layout = hallLayout(companies, sectors);

  it("puts the first sector's bookcase across from the entrance and the others alternately right and left of it", () => {
    // seen from the entrance: Energy on the left, Information Technology straight ahead, Financials on the right
    expect(layout.alcoves.map((alcove) => alcove.sector)).toEqual(["Energy", "Information Technology", "Financials"]);
    expect(layout.alcoves[1].mid).toBeCloseTo(0, 12);
    expect(layout.alcoves[0].mid).toBeLessThan(0);
    expect(layout.alcoves[2].mid).toBeGreaterThan(0);
    const { entranceHalf, radius } = ROTUNDA;
    let previous = -Math.PI + entranceHalf - 1e-9;
    for (const alcove of layout.alcoves) {
      expect(alcove.start).toBeGreaterThan(previous);
      expect(alcove.end).toBeGreaterThan(alcove.start);
      expect(alcove.end).toBeLessThan(Math.PI - entranceHalf + 1e-9);
      expect(alcove.width).toBeCloseTo((alcove.end - alcove.start) * radius, 9);
      previous = alcove.end;
    }
    // the bookcases take at most their share of the wall, the piers the rest; with as many companies as the index
    // they take exactly that share, with fewer the books reach their largest size first
    const wall = radius * (TWO_PI - 2 * entranceHalf);
    const share = (books: typeof companies) => hallLayout(books, sectors).alcoves.reduce((sum, alcove) => sum + alcove.width, 0) / wall;
    expect(share(companies)).toBeLessThanOrEqual(ROTUNDA.alcoveShare + 0.005);
    const index = Array.from({ length: 480 }, (_, item) => ({ cik: item, ticker: `X${item}`, sector: sectors[item % 3], held: 3e12 / (item + 1) }));
    expect(share(index)).toBeCloseTo(ROTUNDA.alcoveShare, 2);
    // a pier between every two bookcases and at both sides of the entrance, all of them clear of the bookcases
    expect(layout.piers).toHaveLength(sectors.length + 1);
    expect(layout.piers[0].start).toBeCloseTo(-Math.PI + entranceHalf, 12);
    expect(layout.piers.at(-1)!.end).toBeCloseTo(Math.PI - entranceHalf, 12);
    for (const pier of layout.piers) for (const alcove of layout.alcoves) expect(pier.end <= alcove.start + 1e-9 || pier.start >= alcove.end - 1e-9).toBe(true);
  });

  it("puts every held company's book on a shelf of its own bookcase, without two books overlapping", () => {
    expect(layout.books).toHaveLength(130);
    const shelves = new Map<string, { from: number; to: number }[]>();
    for (const book of layout.books) {
      const alcove = layout.alcoves.find((item) => item.sector === book.sector)!;
      const half = book.thickness / 2 / ROTUNDA.radius;
      expect(book.angle - half).toBeGreaterThanOrEqual(alcove.start - 1e-9);
      expect(book.angle + half).toBeLessThanOrEqual(alcove.end + 1e-9);
      expect(book.y - book.height / 2).toBeGreaterThanOrEqual(ROTUNDA.shelfBase + book.row * ROTUNDA.rowHeight - 1e-9);
      expect(book.y + book.height / 2).toBeLessThanOrEqual(ROTUNDA.shelfBase + (book.row + 1) * ROTUNDA.rowHeight + 1e-9);
      // a book stands just behind the face of the bookcase, facing the centre
      expect(Math.hypot(book.x, book.z)).toBeCloseTo(ROTUNDA.radius + ROTUNDA.bookDepth / 2, 9);
      expect(angleOf(book.x, book.z)).toBeCloseTo(book.angle, 9);
      const key = `${book.sector}|${book.row}`;
      (shelves.get(key) ?? shelves.set(key, []).get(key)!).push({ from: book.angle - half, to: book.angle + half });
    }
    for (const spans of shelves.values()) {
      spans.sort((a, b) => a.from - b.from);
      for (let index = 1; index < spans.length; index++) expect(spans[index].from).toBeGreaterThanOrEqual(spans[index - 1].to - 1e-9);
    }
    // the largest company stands in the middle of the eye-level shelf, and more money is a bigger book
    const first = layout.books.find((book) => book.cik === 1000)!;
    expect(first.row).toBe(1);
    expect(first.angle).toBeCloseTo(layout.alcoves.find((alcove) => alcove.sector === "Information Technology")!.mid, 9);
    expect(first.thickness).toBeGreaterThan(layout.books.find((book) => book.cik === 1069)!.thickness);
  });
});

describe("where people stand", () => {
  const alcove = { start: -1.2, end: -0.6, mid: -0.9 };

  it("fills the space in front of a bookcase from the books inwards, nobody on top of anybody", () => {
    const slots = crowdSlots(alcove, 140);
    expect(slots).toHaveLength(140);
    const radii = slots.map((slot) => Math.hypot(slot.x, slot.z));
    expect(Math.max(...radii)).toBeCloseTo(ROTUNDA.radius - ROTUNDA.crowdFront, 6);
    for (const radius of radii) expect(radius).toBeGreaterThanOrEqual(ROTUNDA.crowdInner - 1e-6);
    // the first places are the nearest to the middle of the bookcase
    expect(Math.abs(slots[0].angle - alcove.mid)).toBeLessThan(0.05);
    for (let index = 0; index < slots.length; index++) {
      for (let other = index + 1; other < slots.length; other++) {
        expect(Math.hypot(slots[index].x - slots[other].x, slots[index].z - slots[other].z)).toBeGreaterThan(ROTUNDA.crowdSpacing * 0.5);
      }
    }
  });

  it("gives each crowd its own wedge of the floor and grows it as a cluster in front of its bookcase", () => {
    const layout = hallLayout(companies, sectors);
    const wedges = crowdWedges(layout.alcoves);
    const [left, middle, right] = layout.alcoves;
    const [low, high] = wedges.get(middle.sector)!;
    expect(low).toBeCloseTo((left.mid + middle.mid) / 2, 12);
    expect(high).toBeCloseTo((middle.mid + right.mid) / 2, 12);
    // the outermost wedges stop short of the entrance
    expect(wedges.get(left.sector)![0]).toBeGreaterThan(-Math.PI + ROTUNDA.entranceHalf);
    expect(wedges.get(right.sector)![1]).toBeLessThan(Math.PI - ROTUNDA.entranceHalf);
    const slots = crowdSlots(middle, 60, [low, high]);
    for (const slot of slots) {
      expect(slot.angle).toBeGreaterThanOrEqual(low - 1e-9);
      expect(slot.angle).toBeLessThanOrEqual(high + 1e-9);
    }
    // a cluster wider than deep, round the middle of the front row
    const radii = slots.map((slot) => Math.hypot(slot.x, slot.z));
    const angles = slots.map((slot) => slot.angle);
    expect((Math.max(...angles) - Math.min(...angles)) * (ROTUNDA.radius - ROTUNDA.crowdFront)).toBeGreaterThan(Math.max(...radii) - Math.min(...radii));
    expect(Math.abs(angles.reduce((sum, angle) => sum + angle, 0) / angles.length - middle.mid)).toBeLessThan(0.05);
    // a crowd too large for its wedge spreads beyond it instead of piling up
    const many = crowdSlots(middle, 700, [low, high]);
    expect(many).toHaveLength(700);
    expect(many.some((slot) => slot.angle < low || slot.angle > high)).toBe(true);
  });

  it("keeps the staff round the map table and lets a walk go round it, not across", () => {
    const staff = staffSlots(25);
    for (const slot of staff) expect(Math.hypot(slot.x, slot.z)).toBeCloseTo(ROTUNDA.staffRing, 9);
    const [x, , z] = polar(0.1, 20);
    const from = { x, z, angle: 0.1 };
    const [x2, , z2] = polar(Math.PI - 0.6, 20);
    const to = { x: x2, z: z2, angle: Math.PI - 0.6 };
    for (let step = 0; step <= 20; step++) {
      const [px, pz] = walkPoint(from, to, step / 20);
      expect(Math.hypot(px, pz)).toBeGreaterThan(ROTUNDA.mapRadius + 1);
    }
    expect(walkPoint(from, to, 1)[0]).toBeCloseTo(to.x, 9);
    expect(walkLength(from, to)).toBeGreaterThan(Math.hypot(to.x - from.x, to.z - from.z));
  });
});
