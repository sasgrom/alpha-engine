/**
 * People visiting other bookcases: a fund with a sizable stake in another sector (a purchase of 1.5% of its book or
 * more, or a lean of 5 points against all funds; `FlowQuarter.places`) now and then walks over to that bookcase,
 * stands at the edge of the crowd there for a while and walks back. Pure choices here; the stage moves the people.
 */

export interface Visitor { cik: number; stakes: { sector: string; weight: number }[] }

export interface Visit { cik: number; sector: string }

/**
 * Who sets off next: everybody with a stake elsewhere takes a turn, in order of the fund's number from a point that
 * moves on every round, skipping those already on their way (or selected). A fund with several stakes visits them in
 * turn, its largest stake most often.
 */
export function nextVisits(visitors: Visitor[], busy: Set<number>, round: number, count: number): Visit[] {
  const ready = visitors.filter((visitor) => visitor.stakes.length > 0).sort((a, b) => a.cik - b.cik);
  if (!ready.length || count <= 0) return [];
  const visits: Visit[] = [];
  const start = (round * count) % ready.length;
  for (let step = 0; step < ready.length && visits.length < count; step++) {
    const visitor = ready[(start + step) % ready.length];
    if (busy.has(visitor.cik)) continue;
    // the largest stake twice as often as each of the others
    const stakes = [...visitor.stakes].sort((a, b) => b.weight - a.weight || a.sector.localeCompare(b.sector));
    const turns = [stakes[0], ...stakes];
    visits.push({ cik: visitor.cik, sector: turns[(round + visitor.cik) % turns.length].sector });
  }
  return visits;
}

/** How long a visit lasts once there, in seconds: between seven and eleven, the same for a fund every time. */
export function stayFor(cik: number): number {
  return 7 + ((cik * 0.618034) % 1) * 4;
}
