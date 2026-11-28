/**
 * Trading volume for the money map and the company page (contracts/fund-flows.ts, FlowTradingFile). Pure functions;
 * scripts/build-flow-trading.mts does the reading and writing.
 */

/** Sessions grouped by calendar week (Monday to Friday), in order; each week names its last session. */
export function weeksOf(sessions: string[]): { end: string; index: number[] }[] {
  const out: { end: string; index: number[] }[] = [];
  let key = "";
  sessions.forEach((date, index) => {
    const day = new Date(`${date}T12:00:00Z`);
    const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday !== key) {
      key = monday;
      out.push({ end: date, index: [index] });
    } else {
      const week = out[out.length - 1];
      week.index.push(index);
      week.end = date;
    }
  });
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The usual daily dollar volume before session `first`: the median of the 20 sessions before it, at least 10 traded. */
export function normalBefore(daily: (number | null)[], first: number, lookback = 20, minimum = 10): number | null {
  const window = daily.slice(Math.max(0, first - lookback), first).filter((value): value is number => value !== null && value > 0);
  return window.length >= minimum ? median(window) : null;
}

/** A week's dollar volume and its ratio to normal (the week's traded sessions × the usual day). */
export function weekVolume(daily: (number | null)[], index: number[]): { dollars: number | null; vsNormal: number | null } {
  const traded = index.map((i) => daily[i]).filter((value): value is number => value !== null && value > 0);
  if (!traded.length) return { dollars: null, vsNormal: null };
  const dollars = traded.reduce((sum, value) => sum + value, 0);
  const normal = normalBefore(daily, index[0]);
  return { dollars, vsNormal: normal ? dollars / (traded.length * normal) : null };
}

/** A group's ratio to normal: the members' dollars over the same members' usual days (members with both only). */
export function groupVsNormal(members: { daily: (number | null)[] }[], index: number[]): number | null {
  let dollars = 0, usual = 0;
  for (const member of members) {
    const traded = index.map((i) => member.daily[i]).filter((value): value is number => value !== null && value > 0);
    const normal = normalBefore(member.daily, index[0]);
    if (!traded.length || !normal) continue;
    dollars += traded.reduce((sum, value) => sum + value, 0);
    usual += traded.length * normal;
  }
  return usual > 0 ? dollars / usual : null;
}

export interface ShareCapture {
  capturedAt: string;
  shares: number;
  price: number | null;
}

/**
 * The session a capture follows: the latest session whose close (21:00 UTC, the winter close; 20:00 in summer, so a
 * summer capture between 20:00 and 21:00 counts one session early) is at or before the capture.
 */
export function sessionBefore(sessions: string[], capturedAt: string): string | null {
  let found: string | null = null;
  for (const date of sessions) {
    if (`${date}T21:00:00.000Z` <= capturedAt) found = date;
    else break;
  }
  return found;
}

/**
 * Money in (+) or out (−) of one ETF per week: each change in shares outstanding between consecutive captures, valued
 * at the later capture's price, counted in the week of the session the later capture follows.
 */
export function etfWeekFlows(captures: ShareCapture[], sessions: string[], weeks: { end: string; index: number[] }[]): { dollars: (number | null)[]; from: string | null; to: string | null } {
  const sorted = [...captures].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const dollars: (number | null)[] = weeks.map(() => null);
  if (sorted.length < 2) return { dollars, from: sorted[0]?.capturedAt ?? null, to: sorted[0]?.capturedAt ?? null };
  const weekOfSession = new Map<string, number>();
  weeks.forEach((week, w) => week.index.forEach((i) => weekOfSession.set(sessions[i], w)));
  // weeks from the first capture's session on are known (zero when nothing changed)
  const firstSession = sessionBefore(sessions, sorted[0].capturedAt);
  const firstWeek = firstSession ? weekOfSession.get(firstSession) ?? 0 : 0;
  for (let w = firstWeek; w < weeks.length; w++) dollars[w] = 0;
  for (let k = 1; k < sorted.length; k++) {
    const change = sorted[k].shares - sorted[k - 1].shares;
    const price = sorted[k].price;
    if (change === 0 || price === null) continue;
    const session = sessionBefore(sessions, sorted[k].capturedAt);
    const w = session ? weekOfSession.get(session) : undefined;
    if (w === undefined) continue;
    dollars[w] = (dollars[w] ?? 0) + change * price;
  }
  return { dollars, from: sorted[0].capturedAt, to: sorted[sorted.length - 1].capturedAt };
}
