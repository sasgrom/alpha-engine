/**
 * The quarter told as a short walk through the hall: a handful of prepared views, each with a caption that says in
 * numbers what the money on screen is doing. Pure: the page turns a step's `go` into a camera view and a selection.
 */
import { FLOW_OUTSIDE, type FlowLink, type FlowQuarter } from "@contracts/fund-flows";
import { fmtCap } from "../format";
import { quarterLabel, signedCap } from "./data";

export type StoryGo =
  | { view: "overview" }
  | { view: "door" }
  | { sector: string }
  | { company: number };

export interface StoryStep {
  id: "quarter" | "into" | "out" | "outside" | "bought" | "sold";
  title: string;
  /** One or two sentences; the second explains how to read what is on screen. */
  text: string;
  hint: string;
  go: StoryGo;
}

const OUTSIDE_NAME = "outside the covered stocks";
const place = (sector: string) => (sector === FLOW_OUTSIDE ? OUTSIDE_NAME : sector);

/** The widest streams into (or out of) a sector, as "Financials ($12.30B) and Energy ($4.10B)". */
function widest(links: FlowLink[], sector: string, side: "into" | "out"): string | null {
  const rows = links
    // money that changed hands inside the sector is not a ribbon arriving or leaving
    .filter((link) => link.from !== link.to && (side === "into" ? link.to === sector : link.from === sector) && link.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 2)
    .map((link) => `${place(side === "into" ? link.from : link.to)} (${fmtCap(link.usd)})`);
  return rows.length ? rows.join(" and ") : null;
}

export function quarterStory(row: FlowQuarter, names: Map<number, string> = new Map()): StoryStep[] {
  const quarter = quarterLabel(row.quarter);
  const steps: StoryStep[] = [
    {
      id: "quarter",
      title: `${quarter} at a glance`,
      text: `${row.funds} funds bought ${fmtCap(row.bought)} and sold ${fmtCap(row.sold)} of the covered stocks.`,
      hint: "Each bookcase is a sector. A ribbon overhead is money that moved between two sectors: red at the end where it was sold, blue where it was bought, and as wide as the dollars.",
      go: { view: "overview" },
    },
  ];
  const sectors = [...row.sectors].sort((a, b) => b.net - a.net);
  const top = sectors[0];
  const bottom = sectors.at(-1);
  if (top && top.net > 0) {
    const from = widest(row.rotation, top.sector, "into");
    steps.push({
      id: "into",
      title: `Most money went into ${top.sector}`,
      text: `${top.sector} took in ${signedCap(top.net)} net: ${fmtCap(top.bought)} bought, ${fmtCap(top.sold)} sold.${from ? ` The widest ribbons arriving here come from ${from}.` : ""}`,
      hint: "The lit ribbons are this sector's: blue ends arrive here, red ends leave. The board above the bookcase shows what came in and what went out.",
      go: { sector: top.sector },
    });
  }
  if (bottom && bottom.net < 0 && bottom.sector !== top?.sector) {
    const to = widest(row.rotation, bottom.sector, "out");
    steps.push({
      id: "out",
      title: `Most money came out of ${bottom.sector}`,
      text: `${bottom.sector} lost ${signedCap(bottom.net)} net: ${fmtCap(bottom.sold)} sold, ${fmtCap(bottom.bought)} bought.${to ? ` The widest ribbons leaving here go to ${to}.` : ""}`,
      hint: "A book pushed back into the shelf was sold; a book pulled out was bought. The further it moved, the more dollars.",
      go: { sector: bottom.sector },
    });
  }
  const arriving = row.rotation.filter((link) => link.from === FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0);
  const leaving = row.rotation.filter((link) => link.to === FLOW_OUTSIDE).reduce((sum, link) => sum + link.usd, 0);
  if (arriving > 0 || leaving > 0) {
    steps.push({
      id: "outside",
      title: "Money through the door",
      text: `${fmtCap(arriving)} of new money came in from ${OUTSIDE_NAME} and ${fmtCap(leaving)} left: cash, bonds and other shares.`,
      hint: "An estimate. A fund's sales are paired with its own purchases of the quarter; what it bought beyond its sales came in through the door, what it sold beyond its purchases went out.",
      go: { view: "door" },
    });
  }
  const bought = row.topBought[0];
  if (bought) {
    const name = names.get(bought.cik);
    steps.push({
      id: "bought",
      title: `Most bought: ${bought.ticker}`,
      text: `${name ? `${name} (${bought.ticker})` : bought.ticker} took in ${signedCap(bought.net)} net: ${bought.buyers} funds bought ${fmtCap(bought.bought)}, ${bought.sellers} sold ${fmtCap(bought.sold)}.`,
      hint: "The threads join this book to the funds that traded it: blue from a buyer, red from a seller. The panel lists them.",
      go: { company: bought.cik },
    });
  }
  const sold = row.topSold[0];
  if (sold && sold.cik !== bought?.cik) {
    const name = names.get(sold.cik);
    steps.push({
      id: "sold",
      title: `Most sold: ${sold.ticker}`,
      text: `${name ? `${name} (${sold.ticker})` : sold.ticker} lost ${signedCap(sold.net)} net: ${sold.sellers} funds sold ${fmtCap(sold.sold)}, ${sold.buyers} bought ${fmtCap(sold.bought)}.`,
      hint: "Select any book or person yourself to follow its money the same way; select it again to let it go.",
      go: { company: sold.cik },
    });
  }
  return steps;
}
