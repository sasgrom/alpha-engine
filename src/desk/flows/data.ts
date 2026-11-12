/**
 * Data and wording of the fund-flow view. Everything shown is derived from the files of
 * scripts/build-fund-flows.mts; the sentences are written from those numbers, not by a model.
 */
import { trpc } from "@/providers/trpc";
import { FLOW_OUTSIDE, type FlowQuarter, type FundFlowsOverview } from "@contracts/fund-flows";
import { fmtCap, fmtPct } from "../format";
import type { BriefPart } from "../data";

const LONG = { staleTime: 30 * 60_000, refetchOnWindowFocus: false, retry: 1 } as const;

/** `enabled` is false for readers outside the research audience: the page sends them away without asking the server. */
export function useFlowsOverview(enabled = true) {
  return trpc.desk.flowsOverview.useQuery(undefined, { ...LONG, enabled });
}

export function useFlowsFund(cik: number | null) {
  return trpc.desk.flowsFund.useQuery({ cik: cik ?? 0 }, { ...LONG, enabled: !!cik });
}

export function useFlowsCompany(cik: number | null) {
  return trpc.desk.flowsCompany.useQuery({ cik: cik ?? 0 }, { ...LONG, enabled: !!cik });
}

/** "2026-06-30" → "Q2 2026". */
export function quarterLabel(quarter: string): string {
  return `Q${Math.ceil(Number(quarter.slice(5, 7)) / 3)} ${quarter.slice(0, 4)}`;
}

export function shortQuarter(quarter: string): string {
  return `Q${Math.ceil(Number(quarter.slice(5, 7)) / 3)} ’${quarter.slice(2, 4)}`;
}

/** The quarter in one sentence: how much moved and where it went, net. */
export function quarterSentence(row: FlowQuarter): BriefPart[] {
  const sectors = row.sectors.filter((sector) => sector.sector !== "Other");
  const into = sectors.filter((sector) => sector.net > 0).slice(0, 2);
  const out = [...sectors].reverse().filter((sector) => sector.net < 0).slice(0, 2);
  const list = (items: typeof sectors) => items.flatMap((item, index) => [...(index ? [" and "] : []), { strong: item.sector }, ` (${item.net > 0 ? "+" : "−"}${fmtCap(Math.abs(item.net))})`] as BriefPart[]);
  return [
    `In ${quarterLabel(row.quarter)}, ${row.funds} funds bought `,
    { strong: fmtCap(row.bought) },
    " and sold ",
    { strong: fmtCap(row.sold) },
    " of the covered stocks.",
    ...(into.length ? [" Net, money went into ", ...list(into)] : []),
    ...(out.length ? [into.length ? " and came out of " : " Net, money came out of ", ...list(out)] : []),
    ".",
  ];
}

export interface FlowRecord {
  measured: number;
  positive: number;
  mean: number | null;
}

/** Across the quarters with an outcome: how often what was bought beat what was sold, and by how much on average. */
export function spreadRecord(quarters: FlowQuarter[], pick: (row: FlowQuarter) => number | null): FlowRecord {
  const values = quarters.map(pick).filter((value): value is number => value !== null);
  return { measured: values.length, positive: values.filter((value) => value > 0).length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
}

/**
 * Dollars gained or lost since on the money that moved: what was bought, and what the sold dollars would have made.
 * `deflator` is the price level now over the price level then; above 1 it restates the result after inflation.
 */
export function moneySince(row: FlowQuarter, deflator = 1): { bought: number | null; sold: number | null; boughtReturn: number | null; soldReturn: number | null } {
  const after = (value: number | null) => (value === null ? null : (1 + value) / deflator - 1);
  const boughtReturn = after(row.toDate.bought);
  const soldReturn = after(row.toDate.sold);
  return {
    bought: boughtReturn === null ? null : row.bought * boughtReturn,
    sold: soldReturn === null ? null : row.sold * soldReturn,
    boughtReturn,
    soldReturn,
  };
}

/** Price level at the latest quarter over the price level at `row`: what a dollar of then is in dollars of now. */
export function deflatorSince(overview: FundFlowsOverview, row: FlowQuarter): number {
  const latest = [...overview.quarters].reverse().find((quarter) => quarter.cpi !== null)?.cpi ?? null;
  return latest && row.cpi ? latest / row.cpi : 1;
}

export type Who = "all" | "winners" | "losers";

export interface Standing {
  /** The funds the hall keeps for the switch (null: everybody). */
  keep: Set<number> | null;
  winners: number;
  losers: number;
  /** All tracked funds' return in the quarter: the bar a fund's own book is measured against (null: not known). */
  bar: number | null;
}

/**
 * Winners and losers of a quarter: a fund whose book (as reported at the start of the quarter, held through it) did
 * better than all tracked funds together is a winner, worse a loser. Relative, so a falling quarter has winners too.
 * A fund without both reports, or exactly at the bar, is neither.
 */
export function standingOf(row: Pick<FlowQuarter, "fundReturns" | "allFundsReturn">, who: Who): Standing {
  const bar = row.allFundsReturn;
  const winners = new Set<number>();
  const losers = new Set<number>();
  if (bar !== null) {
    for (const [cik, value] of row.fundReturns ?? []) {
      if (value > bar) winners.add(cik);
      else if (value < bar) losers.add(cik);
    }
  }
  const split = bar !== null && winners.size + losers.size > 0;
  return { keep: !split || who === "all" ? null : who === "winners" ? winners : losers, winners: winners.size, losers: losers.size, bar };
}

/** The sectors in the order of the hall's bookcases: the build's order (largest holdings first), else worked out here. */
export function hallSectorOrder(overview: FundFlowsOverview): string[] {
  if (overview.sectorNames?.length) return overview.sectorNames;
  const held = new Map<string, number>();
  for (const company of overview.companies) if (company.sector && company.sector !== "Other") held.set(company.sector, (held.get(company.sector) ?? 0) + company.held);
  return [...held].sort((a, b) => b[1] - a[1]).map(([sector]) => sector);
}

export function sectorNames(overview: FundFlowsOverview): string[] {
  const latest = overview.quarters.at(-1);
  return (latest?.sectors ?? []).map((sector) => sector.sector).filter((name) => name !== "Other" && name !== FLOW_OUTSIDE).sort();
}

export function signedCap(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value < 0 ? "−" : "+"}${fmtCap(Math.abs(value)).replace("—", "$0")}`;
}

export function pctOrDash(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : fmtPct(value, digits);
}
