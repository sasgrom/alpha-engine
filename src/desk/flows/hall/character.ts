/**
 * Age, build and what a person carries, from its firm's history and size: firms on EDGAR since its first years are
 * older people (grey or white hair, some with a cane), firms of the last decade younger (some on a scooter or a bike),
 * the larger funds broader. Technology holders who carry nothing else carry a laptop. Pure functions.
 */

export type Age = "senior" | "middle" | "young";
export type Carry = "cane" | "scooter" | "bike" | "laptop" | null;

/** Filers that report under a newer CIK of the same firm: the age is the older filer's. */
export const SAME_FIRM: Record<number, number> = { 2012383: 1364742, 2100119: 102909 };

/** The firm's first SEC filing, taking an earlier filer of the same firm into account. */
export function firstFiledOf(cik: number, firstFiled: Map<number, string | null>): string | null {
  const own = firstFiled.get(cik) ?? null;
  const older = SAME_FIRM[cik] ? firstFiled.get(SAME_FIRM[cik]) ?? null : null;
  return [own, older].filter((date): date is string => Boolean(date)).sort()[0] ?? null;
}

/** On EDGAR by 1996 (its first years): a senior figure; by 2009 middle-aged; later young. Unknown: middle-aged. */
export function ageFor(firstFiled: string | null): Age {
  if (!firstFiled) return "middle";
  const year = Number(firstFiled.slice(0, 4));
  return year <= 1996 ? "senior" : year <= 2009 ? "middle" : "young";
}

/** A number in [0, 1) from a CIK and a salt, the same every time. */
function hash(cik: number, salt: number): number {
  let state = (cik * 2654435761 + salt * 40503) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
}

const GREY = ["#8f8d89", "#b3b0aa", "#d6d3cc", "#e8e6e1"];

export interface Character {
  age: Age;
  /** Hair for a senior (grey to white); null keeps the person's own colour. */
  hair: string | null;
  /** Build: slimmer for the smallest funds, broader for the largest. */
  girth: number;
  carry: Carry;
  /** Walking pace against an ordinary walk: seniors slower, riders faster. */
  pace: number;
}

/**
 * The character of a fund's figure. `size` is its place on the money scale (0 smallest, 1 largest), `tech` whether its
 * home is a technology sector, `staff` whether it is one of the library's staff (they carry nothing).
 */
export function characterFor(cik: number, firstFiled: string | null, size: number, tech: boolean, staff: boolean): Character {
  const age = ageFor(firstFiled);
  const pick = hash(cik, 1);
  const recent = firstFiled !== null && Number(firstFiled.slice(0, 4)) >= 2015;
  let carry: Carry = null;
  if (!staff) {
    if (age === "senior" && pick < 0.35) carry = "cane";
    else if (age === "young" && recent && pick < 0.3) carry = "scooter";
    else if (age === "young" && recent && pick < 0.5) carry = "bike";
    else if (tech && pick > 0.5) carry = "laptop";
  }
  const girth = 0.9 + 0.28 * Math.min(1, Math.max(0, size)) + (hash(cik, 2) - 0.5) * 0.06;
  const hair = age === "senior" ? GREY[Math.floor(hash(cik, 3) * GREY.length)] : age === "middle" && hash(cik, 4) < 0.3 ? GREY[Math.floor(hash(cik, 5) * 2)] : null;
  const pace = carry === "cane" ? 0.7 : carry === "scooter" ? 1.5 : carry === "bike" ? 1.7 : age === "senior" ? 0.85 : 1;
  return { age, hair, girth, carry, pace };
}
