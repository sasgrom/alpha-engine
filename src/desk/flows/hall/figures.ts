/**
 * Who a fund is in the hall: the leader of its firm in the quarter (from public sources), the figure that follows
 * from it, the clothes that follow from where its money stands, and its size. Pure functions, no rendering.
 */
import type { FlowQuarter } from "@contracts/fund-flows";
import { FUND_LEADERS } from "./leaders-data";
import type { BodyKind } from "./people";

export interface Leader { name: string; gender: "f" | "m" | null }

/** The leader of a filer's firm at a quarter end, or null when the firm is not in the leaders table. */
export function leaderAt(cik: number, quarter: string): Leader | null {
  const entry = FUND_LEADERS[cik];
  if (!entry) return null;
  const month = quarter.slice(0, 7);
  // the leader in office at the quarter end; before the first recorded start, the first leader
  let found = entry.leaders[0] ?? null;
  for (const row of entry.leaders) if (row[1] <= month && (row[2] === null || row[2] >= month)) found = row;
  return found ? { name: found[0], gender: found[3] } : null;
}

export type Outfit = "suit" | "casual" | "tech";

const TECH = new Set(["Information Technology", "Communication Services"]);
const OLD_ECONOMY = new Set(["Financials", "Energy", "Industrials", "Utilities", "Materials", "Real Estate"]);

/** Tech and media holders dress like tech, banks and industry like a bank; health care and consumer in between. */
export function outfitFor(home: string | null): Outfit {
  if (home && TECH.has(home)) return "tech";
  if (home && OLD_ECONOMY.has(home)) return "suit";
  return "casual";
}

/** The figure: a man or a woman when a source says which, dressed for the outfit; a mannequin otherwise. */
export function bodyFor(gender: Leader["gender"] | undefined, outfit: Outfit, cik: number): BodyKind {
  if (gender === "m") return outfit === "suit" ? "man-suit" : outfit === "casual" ? "man-longsleeves" : cik % 2 ? "man-a" : "man-b";
  if (gender === "f") return outfit === "suit" ? "woman" : outfit === "casual" ? "woman-dress" : cik % 2 ? "woman-tanktop" : "woman-casual";
  return "mannequin";
}

/** The size range of the people, as a share of a grown person's height, and the money at its two ends. */
export const FIGURE_SIZE = { smallest: 0.45, largest: 1.2, from: 5e9, to: 1.5e12 } as const;

/**
 * Size follows the money on a log scale, smaller than life: a fund of $5 billion or less stands at 0.45 of a grown
 * person, one of $1.5 trillion or more at 1.2; the typical fund ($35 billion) about 0.7. The two caps keep the very
 * small and the very large in the same picture.
 */
export function figureScale(tracked: number): number {
  const { smallest, largest, from, to } = FIGURE_SIZE;
  const steps = Math.log(Math.max(from, Math.min(to, tracked)) / from) / Math.log(to / from);
  return smallest + (largest - smallest) * steps;
}

export interface Look {
  /** Trousers, the shirt under a jacket, hair, and the wood of a mannequin, as "#rrggbb". */
  pants: string;
  shirt: string;
  hair: string;
  wood: string;
  /** Build: 1 is the model as drawn; a little slimmer or broader, never taller (height is the money). */
  girth: number;
}

const PANTS = ["#2b2f3a", "#3a3a3c", "#4a3b30", "#6b5d48", "#1f2a44", "#585d63", "#2e3b33", "#5a4636"];
const SHIRTS = ["#f4f4f2", "#dce6f2", "#f1e0e0", "#ebe5d3", "#dbe6dc", "#e8e8ee"];
const HAIR = ["#1b1714", "#2f2219", "#5a3f2b", "#8a6a45", "#a8916a", "#7d7a76", "#c9c6c0"];
const WOOD = ["#dcc09a", "#c9a27a", "#b0825a", "#8f6443", "#e3cfae", "#a3714d"];

/** A fund's own look, the same every time: everybody in the hall is a little different. */
export function lookFor(cik: number): Look {
  // independent picks from one integer hash of the CIK
  let state = (cik ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state = (state ^ (state >>> 16)) >>> 0;
    return state / 4294967296;
  };
  const pick = (list: string[]) => list[Math.floor(next() * list.length)];
  return { pants: pick(PANTS), shirt: pick(SHIRTS), hair: pick(HAIR), wood: pick(WOOD), girth: 0.9 + 0.22 * next() };
}

export interface Place { home: string | null; stakes: { sector: string; weight: number }[] }

/** Reads the compact places of a quarter ([fund, home, sector, stake per mille, …]). */
export function decodePlaces(row: Pick<FlowQuarter, "places">, sectorNames: string[]): Map<number, Place> {
  const places = new Map<number, Place>();
  for (const entry of row.places ?? []) {
    const [cik, home, ...rest] = entry;
    const stakes: Place["stakes"] = [];
    for (let index = 0; index + 1 < rest.length; index += 2) if (sectorNames[rest[index]]) stakes.push({ sector: sectorNames[rest[index]], weight: rest[index + 1] / 1000 });
    places.set(cik, { home: home >= 0 ? sectorNames[home] ?? null : null, stakes });
  }
  return places;
}
