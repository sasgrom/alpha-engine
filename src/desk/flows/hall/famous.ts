/**
 * The "people" audience of the hall: the best-known faces behind tracked 13F filers, standing for their firm's money
 * (founders, chief investment officers, the names the press uses), and the public figures whose trades are not
 * collected, shown as placeholders. A person is a man or a woman as public sources describe them (pages below);
 * figures are generic, never portraits.
 */

export interface FamousFace {
  /** The 13F filer whose money the person stands for. */
  cik: number;
  name: string;
  role: string;
  gender: "f" | "m";
  /** Public page describing the person (role and pronouns). */
  source: string;
}

export const FAMOUS_FACES: FamousFace[] = [
  { cik: 1067983, name: "Warren Buffett", role: "Berkshire Hathaway, chairman", gender: "m", source: "https://en.wikipedia.org/wiki/Warren_Buffett" },
  { cik: 1423053, name: "Ken Griffin", role: "Citadel, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Ken_Griffin" },
  { cik: 1009207, name: "David E. Shaw", role: "D. E. Shaw, founder", gender: "m", source: "https://en.wikipedia.org/wiki/David_E._Shaw" },
  { cik: 1179392, name: "John Overdeck", role: "Two Sigma, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/John_Overdeck" },
  { cik: 1273087, name: "Israel Englander", role: "Millennium Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Israel_Englander" },
  { cik: 1135730, name: "Philippe Laffont", role: "Coatue Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Philippe_Laffont" },
  { cik: 1603466, name: "Steve Cohen", role: "Point72, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Steven_A._Cohen" },
  { cik: 1037389, name: "Jim Simons", role: "Renaissance Technologies, founder (died 2024)", gender: "m", source: "https://en.wikipedia.org/wiki/Jim_Simons" },
  { cik: 1166559, name: "Bill Gates", role: "Gates Foundation Trust", gender: "m", source: "https://en.wikipedia.org/wiki/Bill_Gates" },
  { cik: 1745981, name: "Igor Tulchinsky", role: "WorldQuant, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Igor_Tulchinsky" },
  { cik: 1103804, name: "Andreas Halvorsen", role: "Viking Global, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Andreas_Halvorsen" },
  { cik: 1510387, name: "Joel Greenblatt", role: "Gotham Asset Management, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Joel_Greenblatt" },
  { cik: 1167483, name: "Chase Coleman", role: "Tiger Global, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Chase_Coleman_III" },
  { cik: 1350694, name: "Ray Dalio", role: "Bridgewater Associates, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Ray_Dalio" },
  { cik: 923093, name: "Paul Tudor Jones", role: "Tudor Investment, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Paul_Tudor_Jones" },
  { cik: 1791786, name: "Paul Singer", role: "Elliott Investment Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Paul_Singer_(businessman)" },
  { cik: 1061165, name: "Stephen Mandel", role: "Lone Pine Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Stephen_Mandel" },
  { cik: 1697748, name: "Cathie Wood", role: "ARK Invest, founder", gender: "f", source: "https://en.wikipedia.org/wiki/Cathie_Wood" },
  { cik: 1061768, name: "Seth Klarman", role: "Baupost Group, chief executive", gender: "m", source: "https://en.wikipedia.org/wiki/Seth_Klarman" },
  { cik: 1029160, name: "George Soros", role: "Soros Fund Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/George_Soros" },
  { cik: 1040273, name: "Daniel Loeb", role: "Third Point, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Daniel_S._Loeb" },
  { cik: 1517137, name: "Jeff Smith", role: "Starboard Value, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Jeffrey_C._Smith" },
  { cik: 1336528, name: "Bill Ackman", role: "Pershing Square, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Bill_Ackman" },
];

/**
 * Public figures whose trades the hall does not have: placeholders by the entrance. Members of Congress and the
 * executive file their trades under the Ethics in Government Act, whose reports may not be used for commercial
 * purposes (5 U.S.C. § 13107); whether and how they may appear here is the owner's decision.
 */
export const NOT_COLLECTED: { name: string; note: string }[] = [
  { name: "Nancy Pelosi", note: "congressional trade reports, not collected" },
  { name: "Donald Trump", note: "executive financial disclosures, not collected" },
  { name: "Michael Burry", note: "Scion Asset Management: its 13F reports are not in the books yet" },
  { name: "Stanley Druckenmiller", note: "Duquesne Family Office: its 13F reports are not in the books yet" },
  { name: "David Tepper", note: "Appaloosa: its 13F reports are not in the books yet" },
  { name: "Carl Icahn", note: "Icahn Capital: its 13F reports are not in the books yet" },
];

export const FAMOUS_BY_CIK = new Map(FAMOUS_FACES.map((face) => [face.cik, face]));
