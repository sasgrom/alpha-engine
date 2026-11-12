/**
 * Background notes for well-known 13F filers, by SEC CIK. They are general background written by hand — who the
 * firm is and how it is known to invest — and are shown apart from the profile computed from the filings. Each
 * note is limited to stable, widely documented facts; nothing here is a forecast or an assessment of performance.
 * `category` places the fund on a shelf of the catalog when the name and the stored tier would misplace it.
 */
import type { FundCategory } from "./fund-flows";

export interface FundNote {
  /** Display name when the filer's legal name is not how the firm is known. */
  display?: string;
  category?: FundCategory;
  note: string;
}

const VANGUARD = "Part of Vanguard, the firm John C. Bogle founded in 1975 that brought the index fund to ordinary investors and is owned by its own funds. Vanguard reports its holdings through several entities.";
const CAPITAL = "One of the investment groups of Capital Group, the Los Angeles manager of the American Funds, founded in 1931. Its groups invest independently, each portfolio split among several managers, and are known for holding for years.";

export const FUND_NOTES: Record<number, FundNote> = {
  2100119: { category: "index", note: VANGUARD },
  2100121: { category: "index", note: VANGUARD },
  933478: { category: "index", note: VANGUARD },
  1811242: { category: "index", note: VANGUARD },
  1680208: { category: "index", note: VANGUARD },
  1550100: { category: "index", note: VANGUARD },
  947529: { category: "index", note: VANGUARD },
  93751: { display: "State Street", category: "index", note: "Boston bank and custodian. Its asset-management arm launched the first US-listed exchange-traded fund, SPY, in 1993, and most of what it reports is index money." },
  2012383: { display: "BlackRock", category: "index", note: "The world's largest asset manager, founded in 1988 by Larry Fink and partners in New York; its iShares funds make it a top holder of almost every large company." },
  1214717: { display: "Geode Capital Management", category: "index", note: "Boston index manager that runs Fidelity's index funds as sub-adviser." },
  884546: { display: "Charles Schwab Investment Management", category: "index", note: "The fund arm of the Schwab brokerage: mostly index funds and ETFs." },
  764068: { display: "Legal & General", category: "index", note: "British insurer whose investment arm is one of Europe's largest index managers." },
  1374170: { display: "Norges Bank", category: "pension", note: "Norway's central bank, investing the Government Pension Fund Global: the sovereign wealth fund built from oil and gas income, which owns a small slice of most listed companies in the world." },
  1582202: { category: "pension", note: "Switzerland's central bank. It holds US shares as part of its currency reserves and spreads them across the market like an index." },
  1608046: { category: "pension", note: "South Korea's public pension fund, one of the largest pension funds in the world." },
  1283718: { display: "CPP Investments", category: "pension", note: "Invests the assets of the Canada Pension Plan." },
  919079: { display: "CalPERS", category: "pension", note: "The California Public Employees' Retirement System, the largest public pension fund in the United States." },
  1021944: { display: "Temasek", category: "pension", note: "The investment company owned by the government of Singapore." },
  1166559: { category: "pension", note: "The endowment that funds the Gates Foundation: a short list of large positions." },
  1454984: { category: "pension", note: "Investment manager of The Church of Jesus Christ of Latter-day Saints." },
  1422849: { category: "manager", note: CAPITAL },
  1422848: { category: "manager", note: CAPITAL },
  1562230: { category: "manager", note: CAPITAL },
  315066: { display: "Fidelity (FMR)", category: "manager", note: "The Johnson family's Boston firm, founded in 1946 and among the largest managers of actively run mutual funds." },
  902219: { display: "Wellington Management", category: "manager", note: "Boston partnership founded in 1928; it manages active funds for many other firms, Vanguard among them." },
  763212: { display: "Primecap Management", category: "manager", note: "Pasadena growth investor known for long holding periods; it also manages funds for Vanguard." },
  200217: { display: "Dodge & Cox", category: "manager", note: "San Francisco firm founded in 1930: value-minded, managed by committee, and slow to trade." },
  850529: { display: "Fisher Investments", category: "manager", note: "Founded by Ken Fisher in 1979; manages portfolios for private clients and institutions." },
  1109448: { display: "AllianceBernstein", category: "manager", note: "Research-driven active manager formed from Alliance Capital and Sanford C. Bernstein." },
  813917: { display: "Harris Associates", category: "manager", note: "Chicago value manager behind the Oakmark funds." },
  1352662: { display: "GMO", category: "manager", note: "Boston firm co-founded by Jeremy Grantham, known for value investing and for its warnings about market bubbles." },
  1067983: { display: "Berkshire Hathaway", category: "hedge", note: "The Omaha holding company built by Warren Buffett. Beside the businesses it owns outright it keeps a concentrated portfolio of listed shares, bought to be held for decades." },
  1061768: { display: "Baupost Group", category: "hedge", note: "Seth Klarman's Boston value fund. Klarman wrote “Margin of Safety”; the fund is known for holding cash when it finds nothing cheap." },
  1647251: { display: "TCI Fund Management", category: "hedge", note: "Christopher Hohn's London fund (The Children's Investment Fund): a handful of large, long-held positions and a record of activist campaigns." },
  1103804: { display: "Viking Global", category: "hedge", note: "Founded in 1999 by Andreas Halvorsen, one of the “Tiger cubs” who trained at Julian Robertson's Tiger Management; picks stocks on fundamentals, long and short." },
  1167483: { display: "Tiger Global", category: "hedge", note: "Founded in 2001 by Chase Coleman, a Tiger cub; invests in internet and technology growth companies, public and private." },
  1061165: { display: "Lone Pine Capital", category: "hedge", note: "Founded in 1997 by Stephen Mandel, a Tiger cub; a concentrated book of growth companies." },
  1135730: { display: "Coatue Management", category: "hedge", note: "Founded in 1999 by Philippe Laffont, a Tiger cub; focused on technology." },
  1541617: { display: "Altimeter Capital", category: "hedge", note: "Brad Gerstner's technology-focused fund." },
  1697748: { display: "ARK Invest", category: "hedge", note: "Cathie Wood's firm, founded in 2014. Its actively managed ETFs are built around “disruptive innovation”, and it publishes its trades every day." },
  1029160: { display: "Soros Fund Management", category: "hedge", note: "George Soros's family office, heir to the Quantum Fund and its macro trading." },
  1040273: { display: "Third Point", category: "hedge", note: "Daniel Loeb's fund, founded in 1995: event-driven investing and activist campaigns." },
  1517137: { display: "Starboard Value", category: "hedge", note: "Activist fund led by Jeffrey Smith: it takes stakes and presses boards for change." },
  1791786: { display: "Elliott Investment Management", category: "hedge", note: "Paul Singer's firm, founded in 1977 and one of the most active activist investors." },
  1350694: { display: "Bridgewater Associates", category: "hedge", note: "Founded in 1975 by Ray Dalio. A global macro firm, known for its “All Weather” risk-parity approach; its share holdings follow that system rather than stock picking." },
  1165408: { display: "Adage Capital", category: "hedge", note: "Boston fund founded in 2001 by managers from Harvard's endowment; it runs a broad, sector-balanced book." },
  1423053: { display: "Citadel", category: "quant", note: "Ken Griffin's firm, founded in 1990: many strategies under one roof. Its 13F book is large and fast-moving and includes option positions." },
  1273087: { display: "Millennium Management", category: "quant", note: "Israel Englander's firm, founded in 1989: hundreds of independent trading teams under tight risk limits." },
  1037389: { display: "Renaissance Technologies", category: "quant", note: "The quantitative firm founded by the mathematician Jim Simons, famous for its Medallion fund. It trades thousands of names by model." },
  1179392: { display: "Two Sigma", category: "quant", note: "New York quantitative firm founded in 2001 by John Overdeck and David Siegel." },
  1009207: { display: "D. E. Shaw", category: "quant", note: "Founded in 1988 by the computer scientist David E. Shaw; one of the first firms to trade by computation." },
  1603466: { display: "Point72", category: "quant", note: "Steven Cohen's firm, successor to SAC Capital: many portfolio managers trading side by side." },
  1167557: { display: "AQR Capital Management", category: "quant", note: "Founded in 1998 by Cliff Asness and partners; known for factor investing such as value and momentum." },
  1745981: { category: "quant", note: "A quantitative venture of WorldQuant and Millennium." },
  1164508: { display: "Arrowstreet Capital", category: "quant", note: "Boston quantitative manager founded in 1999." },
  1446194: { display: "Susquehanna", category: "quant", note: "Pennsylvania trading firm and options market maker. What it reports is largely market-making inventory and hedges, not long-term views." },
  1045810: { category: "manager", note: "A company, not a fund: Nvidia files a 13F for the stakes it holds in other listed companies." },
};
