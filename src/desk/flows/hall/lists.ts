/**
 * The top-ten lists on the boards between the columns, for a quarter and the current view: the most bought and sold,
 * the largest buyers and sellers, the winners and losers, the most traded, the largest holdings and funds, the most
 * bought technology, and what did best and worst since. The view decides the order; the first lists hang where the
 * reader looks first.
 */
import type { FlowQuarter, FundFlowsOverview } from "@contracts/fund-flows";

export interface ListRow { label: string; value: string; tone: "in" | "out" | "plain"; target: { kind: "company" | "fund"; id: number } | null }
export interface TopList { title: string; note: string; rows: ListRow[] }

const money = (value: number) => {
  const size = Math.abs(value);
  const text = size >= 1e12 ? `$${(size / 1e12).toFixed(2)}T` : size >= 1e9 ? `$${(size / 1e9).toFixed(size >= 1e11 ? 0 : 1)}bn` : `$${(size / 1e6).toFixed(0)}m`;
  return value < 0 ? `−${text}` : text;
};
const signed = (value: number) => (value > 0 ? `+${money(value)}` : money(value));
const percent = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;

export function topLists(overview: FundFlowsOverview, row: FlowQuarter, mode: "flow" | "outcome" | "held", who: "all" | "winners" | "losers"): TopList[] {
  const companyName = new Map(overview.companies.map((company) => [company.cik, company]));
  const fundName = new Map(overview.funds.map((fund) => [fund.cik, fund.name]));
  const company = (cik: number, ticker?: string) => {
    const entry = companyName.get(cik);
    return { label: entry ? `${entry.ticker} · ${entry.name}` : ticker ?? `CIK ${cik}`, target: { kind: "company" as const, id: cik } };
  };
  const fund = (cik: number) => ({ label: fundName.get(cik) ?? `CIK ${cik}`, target: { kind: "fund" as const, id: cik } });
  const ten = <T,>(items: T[]) => items.slice(0, 10);

  const mostBought: TopList = { title: "Most bought", note: "net dollars into the company", rows: ten(row.topBought.filter((item) => item.net > 0)).map((item) => ({ ...company(item.cik, item.ticker), value: signed(item.net), tone: "in" })) };
  const mostSold: TopList = { title: "Most sold", note: "net dollars out of the company", rows: ten(row.topSold.filter((item) => item.net < 0)).map((item) => ({ ...company(item.cik, item.ticker), value: signed(item.net), tone: "out" })) };
  const topBuyers: TopList = { title: "Top buyers", note: "funds, net dollars bought", rows: ten(row.topBuyers.filter((item) => item.net > 0)).map((item) => ({ ...fund(item.cik), value: signed(item.net), tone: "in" })) };
  const topSellers: TopList = { title: "Top sellers", note: "funds, net dollars sold", rows: ten(row.topSellers.filter((item) => item.net < 0)).map((item) => ({ ...fund(item.cik), value: signed(item.net), tone: "out" })) };
  const bar = row.allFundsReturn;
  const returns = [...(row.fundReturns ?? [])];
  const versus = bar === null ? "" : `all funds ${percent(bar)}`;
  const winners: TopList = { title: "Winners", note: `book return this quarter · ${versus}`, rows: bar === null ? [] : ten(returns.filter(([, value]) => value > bar).sort((a, b) => b[1] - a[1])).map(([cik, value]) => ({ ...fund(cik), value: percent(value), tone: "in" })) };
  const losers: TopList = { title: "Losers", note: `book return this quarter · ${versus}`, rows: bar === null ? [] : ten(returns.filter(([, value]) => value < bar).sort((a, b) => a[1] - b[1])).map(([cik, value]) => ({ ...fund(cik), value: percent(value), tone: "out" })) };
  const traded = new Map<number, { cik: number; ticker: string; volume: number }>();
  for (const item of [...row.topBought, ...row.topSold]) traded.set(item.cik, { cik: item.cik, ticker: item.ticker, volume: item.bought + item.sold });
  const mostTraded: TopList = { title: "Most traded", note: "dollars bought plus sold", rows: ten([...traded.values()].sort((a, b) => b.volume - a.volume)).map((item) => ({ ...company(item.cik, item.ticker), value: money(item.volume), tone: "plain" })) };
  const held = [...row.companyFlows].sort((a, b) => b[2] - a[2]);
  const largestHoldings: TopList = { title: "Largest holdings", note: "value held by the tracked funds", rows: ten(held).map(([cik, , value]) => ({ ...company(cik), value: money(value), tone: "plain" })) };
  const reporting = new Set(row.fundFlows.map(([cik]) => cik));
  const largestFunds: TopList = { title: "Largest funds", note: "covered stocks in their books", rows: ten(overview.funds.filter((item) => reporting.has(item.cik)).sort((a, b) => b.tracked - a.tracked)).map((item) => ({ ...fund(item.cik), value: money(item.tracked), tone: "plain" })) };
  const technology = row.companyFlows.filter(([cik]) => companyName.get(cik)?.sector === "Information Technology");
  const techBought: TopList = { title: "Technology", note: "most bought in Information Technology", rows: ten([...technology].filter(([, net]) => net > 0).sort((a, b) => b[1] - a[1])).map(([cik, net]) => ({ ...company(cik), value: signed(net), tone: "in" })) };
  const techHeld: TopList = { title: "Technology", note: "most held in Information Technology", rows: ten([...technology].sort((a, b) => b[2] - a[2])).map(([cik, , value]) => ({ ...company(cik), value: money(value), tone: "plain" })) };
  const since = row.companyFlows.filter(([, , , value]) => value !== null) as [number, number, number, number][];
  const bestSince: TopList = { title: "Best since", note: "stock return from the quarter end to now", rows: ten([...since].sort((a, b) => b[3] - a[3])).map(([cik, , , value]) => ({ ...company(cik), value: percent(value), tone: "in" })) };
  const worstSince: TopList = { title: "Worst since", note: "stock return from the quarter end to now", rows: ten([...since].sort((a, b) => a[3] - b[3])).map(([cik, , , value]) => ({ ...company(cik), value: percent(value), tone: "out" })) };

  const order =
    mode === "outcome"
      ? [bestSince, worstSince, winners, losers, mostBought, mostSold, topBuyers, topSellers, largestHoldings, techBought, mostTraded, largestFunds]
      : mode === "held"
        ? [largestHoldings, largestFunds, techHeld, mostBought, mostSold, topBuyers, topSellers, winners, losers, mostTraded, bestSince, worstSince]
        : [mostBought, mostSold, topBuyers, topSellers, winners, losers, mostTraded, techBought, largestHoldings, largestFunds, bestSince, worstSince];
  // the switch's own list first
  const first = who === "winners" ? winners : who === "losers" ? losers : null;
  const lists = first ? [first, ...order.filter((list) => list !== first)] : order;
  return lists.filter((list) => list.rows.length > 0);
}
