/**
 * Desk data: the precomputed snapshot (one request, shared by every desk page through the query cache) and the
 * pure derivations the pages show. Nothing here invents a value: a missing input stays null and is shown as such.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { DESK_PERIOD_LABELS, type DeskCompany, type DeskPeriod, type DeskSnapshot } from "@contracts/desk-snapshot";
import { daysBetween, fmtPct } from "./format";

export function useDeskSnapshot() {
  return trpc.desk.snapshot.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 });
}

/**
 * A whitelisted report file (the classic research artifacts). Reports are served to the owner and to reviewers who
 * accepted the NDA; a missing file is null, not an error.
 */
export function useReport<T>(name: string, enabled = true, options?: { noStore?: boolean }) {
  return useQuery({
    queryKey: ["desk", "report", name, options?.noStore ? "no-store" : "shared"],
    enabled,
    staleTime: options?.noStore ? 0 : 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<T | null> => {
      const response = await fetch(`/reports/${name}`, { credentials: "include", cache: options?.noStore ? "no-store" : "default" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${name} answered ${response.status}`);
      return (await response.json()) as T;
    },
  });
}

/**
 * The viewer's watchlist: the per-user universe of the classic view. Following an index company only adds a
 * membership row (the company is already in the registry, so no data job starts).
 */
export function useWatchlist() {
  const utils = trpc.useUtils();
  const list = trpc.universe.list.useQuery({ search: "", onlyUniverse: true, page: 0, pageSize: 200 }, { staleTime: 60_000 });
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setError(null);
    void utils.universe.list.invalidate();
    void utils.screener.table.invalidate();
    void utils.dashboard.latestFilings.invalidate();
  };
  const add = trpc.universe.add.useMutation({ onSuccess: done, onError: (failure) => setError(failure.message) });
  const remove = trpc.universe.remove.useMutation({ onSuccess: done, onError: (failure) => setError(failure.message) });
  const rows = useMemo(() => (list.data?.rows ?? []).map((row) => ({ cik: row.cik, ticker: row.ticker, name: row.name ?? null })), [list.data]);
  const ciks = useMemo(() => new Set(rows.map((row) => row.cik)), [rows]);
  return {
    rows,
    ciks,
    isLoading: list.isLoading,
    busy: add.isPending || remove.isPending,
    error,
    follow: (company: Pick<DeskCompany, "ticker">) => add.mutate({ ticker: company.ticker }),
    unfollow: (cik: number) => remove.mutate({ cik }),
  };
}

export function periodLabel(period: DeskPeriod): string {
  return DESK_PERIOD_LABELS[period];
}

export function findCompany(snapshot: DeskSnapshot | null | undefined, ticker: string | undefined): DeskCompany | null {
  if (!snapshot || !ticker) return null;
  const wanted = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return snapshot.companies.find((company) => company.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "") === wanted) ?? null;
}

export function movers(companies: DeskCompany[], period: DeskPeriod, count = 6): { gainers: DeskCompany[]; losers: DeskCompany[] } {
  const ranked = companies.filter((company) => company.returns[period] !== null).sort((a, b) => b.returns[period]! - a.returns[period]!);
  return {
    gainers: ranked.filter((company) => company.returns[period]! > 0).slice(0, count),
    losers: ranked.filter((company) => company.returns[period]! < 0).reverse().slice(0, count),
  };
}

/** Reports in the last `pastDays` calendar days up to the session, and projected reports in the next `aheadDays`. */
export function earningsRadar(snapshot: DeskSnapshot, pastDays = 7, aheadDays = 14): { reported: DeskCompany[]; upcoming: DeskCompany[] } {
  const reported = snapshot.companies
    .filter((company) => company.lastEarnings && daysBetween(company.lastEarnings, snapshot.session) >= 0 && daysBetween(company.lastEarnings, snapshot.session) <= pastDays)
    .sort((a, b) => b.lastEarnings!.localeCompare(a.lastEarnings!) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const upcoming = snapshot.companies
    .filter((company) => company.nextEarnings && daysBetween(snapshot.session, company.nextEarnings) > 0 && daysBetween(snapshot.session, company.nextEarnings) <= aheadDays)
    .sort((a, b) => a.nextEarnings!.localeCompare(b.nextEarnings!) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  return { reported, upcoming };
}

/**
 * Search ranking: exact ticker, ticker prefix, a name word starting with the query, then anywhere in the ticker
 * or name; ties go to the larger company.
 */
export function searchCompanies(companies: DeskCompany[], query: string, limit = 8): DeskCompany[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const scored: { company: DeskCompany; score: number }[] = [];
  for (const company of companies) {
    const ticker = company.ticker.toUpperCase();
    const name = company.name.toUpperCase();
    const score = ticker === q || ticker.replace(/[^A-Z0-9]/g, "") === q.replace(/[^A-Z0-9]/g, "")
      ? 0
      : ticker.startsWith(q)
        ? 1
        : name.split(/[\s.,&()-]+/).some((word) => word.startsWith(q))
          ? 2
          : ticker.includes(q) || name.includes(q)
            ? 3
            : -1;
    if (score >= 0) scored.push({ company, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || (b.company.marketCap ?? 0) - (a.company.marketCap ?? 0))
    .slice(0, limit)
    .map((entry) => entry.company);
}

/** Breadth of any period, measured over the companies with a return for it. */
export function periodBreadth(companies: DeskCompany[], period: DeskPeriod): { measured: number; up: number; down: number; flat: number; median: number | null } {
  const values = companies.map((company) => company.returns[period]).filter((value): value is number => value !== null);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
  return { measured: values.length, up: values.filter((value) => value > 0).length, down: values.filter((value) => value < 0).length, flat: values.filter((value) => value === 0).length, median };
}

/**
 * The options-implied move until the first expiry on or after `daysAhead` calendar days — only when that expiry is
 * close enough to the date (at most 1.6 × the days plus a week) to speak about it; otherwise none.
 */
export function impliedMoveFor(company: DeskCompany, daysAhead: number): { pct: number; days: number } | null {
  const bucket = (company.options?.buckets ?? [])
    .filter((entry) => entry.expectedMovePct !== null && entry.days >= daysAhead && entry.days <= daysAhead * 1.6 + 7)
    .sort((a, b) => a.days - b.days)[0];
  return bucket ? { pct: bucket.expectedMovePct!, days: bucket.days } : null;
}

/** Same industry first, then the rest of the sector, largest first. */
export function peersOf(snapshot: DeskSnapshot, company: DeskCompany, count = 6): DeskCompany[] {
  const others = snapshot.companies.filter((other) => other.cik !== company.cik && other.sector === company.sector);
  const sameIndustry = others.filter((other) => company.industry && other.industry === company.industry);
  const rest = others.filter((other) => !sameIndustry.includes(other));
  const byCap = (a: DeskCompany, b: DeskCompany) => (b.marketCap ?? 0) - (a.marketCap ?? 0);
  return [...sameIndustry.sort(byCap), ...rest.sort(byCap)].slice(0, count);
}

export type BriefPart = string | { strong: string };

/**
 * The session in a few plain sentences, written from the snapshot alone (no model): breadth, the benchmark,
 * the strongest and weakest sector, the largest move among the 50 biggest companies, and 52-week extremes.
 */
export function marketBrief(snapshot: DeskSnapshot): BriefPart[][] {
  const sentences: BriefPart[][] = [];
  const { breadth, benchmark } = snapshot;
  if (breadth.measured) {
    const mood = breadth.advancers > breadth.decliners * 1.5 ? "Most stocks rose" : breadth.decliners > breadth.advancers * 1.5 ? "Most stocks fell" : "It was a mixed session";
    sentences.push([
      `${mood}: `,
      { strong: `${breadth.advancers} of ${breadth.measured}` },
      " S&P 500 companies closed higher and ",
      { strong: String(breadth.decliners) },
      " lower",
      ...(benchmark?.returns.d1 !== null && benchmark?.returns.d1 !== undefined ? [", while ", { strong: `${benchmark.ticker} ${fmtPct(benchmark.returns.d1, 2)}` }] : []),
      ".",
    ]);
  }
  const sectors = snapshot.sectors.filter((sector) => sector.returns.d1 !== null && sector.name !== "Other").sort((a, b) => b.returns.d1! - a.returns.d1!);
  if (sectors.length >= 2) {
    const best = sectors[0];
    const worst = sectors.at(-1)!;
    sentences.push([{ strong: best.name }, ` led (${fmtPct(best.returns.d1, 2)}) and `, { strong: worst.name }, ` lagged (${fmtPct(worst.returns.d1, 2)}).`]);
  }
  const largest = snapshot.companies.slice(0, 50).filter((company) => company.returns.d1 !== null).sort((a, b) => Math.abs(b.returns.d1!) - Math.abs(a.returns.d1!))[0];
  if (largest && Math.abs(largest.returns.d1!) >= 0.015) {
    sentences.push(["Among the largest companies, ", { strong: largest.name }, ` ${largest.returns.d1! > 0 ? "rose" : "fell"} ${fmtPct(Math.abs(largest.returns.d1!), 1, false)}.`]);
  }
  if (breadth.newHighs || breadth.newLows) {
    sentences.push([{ strong: String(breadth.newHighs) }, ` closed at a 52-week high and `, { strong: String(breadth.newLows) }, " at a 52-week low."]);
  }
  return sentences;
}
