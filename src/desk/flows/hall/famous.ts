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
  // Added 2026-11-26 (owner: "more famous traders ... all we can get"). Each filer CIK checked against its SEC
  // submissions (name, 13F-HR reports); each person against a Wikipedia page that names the role and the pronoun.
  // Firms whose leader has no such page stay in the books under the firm's name (ValueAct, D1, Sachem Head, Markel,
  // Harris/Oakmark, Davis, Gardner Russo, Yacktman, Weitz, Corvex, Eminence, Brave Warrior, Marshall Wace, Abrams,
  // Zevenbergen, Semper Augustus, Greenlea Lane, Valley Forge, Durable, Atreides).
  { cik: 1649339, name: "Michael Burry", role: "Scion Asset Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Michael_Burry" },
  { cik: 1536411, name: "Stanley Druckenmiller", role: "Duquesne Family Office, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Stanley_Druckenmiller" },
  { cik: 1656456, name: "David Tepper", role: "Appaloosa Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/David_Tepper" },
  { cik: 921669, name: "Carl Icahn", role: "Icahn Enterprises, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Carl_Icahn" },
  { cik: 1489933, name: "David Einhorn", role: "Greenlight Capital, founder (reports as DME Capital since 2024)", gender: "m", source: "https://en.wikipedia.org/wiki/David_Einhorn_(hedge_fund_manager)" },
  { cik: 1079114, name: "David Einhorn", role: "Greenlight Capital, founder (reports to 2023)", gender: "m", source: "https://en.wikipedia.org/wiki/David_Einhorn_(hedge_fund_manager)" },
  { cik: 1345471, name: "Nelson Peltz", role: "Trian Fund Management, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Nelson_Peltz" },
  { cik: 949509, name: "Howard Marks", role: "Oaktree Capital, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Howard_Marks_(investor)" },
  { cik: 1709323, name: "Li Lu", role: "Himalaya Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Li_Lu" },
  { cik: 1549575, name: "Mohnish Pabrai", role: "Pabrai Investment Funds (Dalal Street), founder", gender: "m", source: "https://en.wikipedia.org/wiki/Mohnish_Pabrai" },
  { cik: 1112520, name: "Chuck Akre", role: "Akre Capital Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Charles_T._Akre" },
  { cik: 1569205, name: "Terry Smith", role: "Fundsmith, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Terry_Smith_(businessman)" },
  { cik: 850529, name: "Ken Fisher", role: "Fisher Investments, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Kenneth_Fisher" },
  { cik: 1135778, name: "Bill Miller", role: "Miller Value Partners, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Bill_Miller_(investor)" },
  { cik: 1998597, name: "Barry Rosenstein", role: "JANA Partners, founder (reports as JANA Partners Management since 2023)", gender: "m", source: "https://en.wikipedia.org/wiki/Barry_Rosenstein" },
  { cik: 1159159, name: "Barry Rosenstein", role: "JANA Partners, founder (reports to 2023)", gender: "m", source: "https://en.wikipedia.org/wiki/Barry_Rosenstein" },
  { cik: 1138995, name: "Larry Robbins", role: "Glenview Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Larry_Robbins" },
  { cik: 934639, name: "Lee Ainslie", role: "Maverick Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Lee_Ainslie" },
  { cik: 1541617, name: "Brad Gerstner", role: "Altimeter Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Brad_Gerstner" },
  { cik: 915191, name: "Prem Watsa", role: "Fairfax Financial, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Prem_Watsa" },
  { cik: 783412, name: "Charlie Munger", role: "Daily Journal, chairman (died 2023)", gender: "m", source: "https://en.wikipedia.org/wiki/Charlie_Munger" },
  { cik: 807985, name: "Mason Hawkins", role: "Southeastern Asset Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Mason_Hawkins" },
  { cik: 936753, name: "John W. Rogers Jr.", role: "Ariel Investments, founder", gender: "m", source: "https://en.wikipedia.org/wiki/John_W._Rogers_Jr." },
  { cik: 1510281, name: "Boaz Weinstein", role: "Saba Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Boaz_Weinstein" },
  { cik: 1027796, name: "Richard Pzena", role: "Pzena Investment Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Richard_Pzena" },
  { cik: 1352662, name: "Jeremy Grantham", role: "GMO, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Jeremy_Grantham" },
  { cik: 1056831, name: "Bruce Berkowitz", role: "Fairholme Capital, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Bruce_R._Berkowitz" },
  { cik: 1512857, name: "Alan Howard", role: "Brevan Howard, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Alan_Howard_(hedge_fund_manager)" },
  { cik: 1647251, name: "Chris Hohn", role: "TCI Fund Management, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Chris_Hohn" },
  { cik: 1035674, name: "John Paulson", role: "Paulson & Co., founder", gender: "m", source: "https://en.wikipedia.org/wiki/John_Paulson" },
  { cik: 1027451, name: "Julian Robertson", role: "Tiger Management, founder (died 2022)", gender: "m", source: "https://en.wikipedia.org/wiki/Julian_Robertson" },
  { cik: 1389507, name: "Rob Citrone", role: "Discovery Capital Management, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Robert_Citrone" },
  { cik: 1817187, name: "Jeffrey Ubben", role: "Inclusive Capital Partners, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Jeffrey_W._Ubben" },
  { cik: 1081407, name: "Mario Gabelli", role: "Gabelli Funds (GAMCO), founder", gender: "m", source: "https://en.wikipedia.org/wiki/Mario_Gabelli" },
  { cik: 1256071, name: "Kerr Neilson", role: "Platinum Asset Management, co-founder", gender: "m", source: "https://en.wikipedia.org/wiki/Kerr_Neilson" },
  { cik: 1695459, name: "Paul Hilal", role: "Mantle Ridge, founder", gender: "m", source: "https://en.wikipedia.org/wiki/Paul_Hilal" },
];

/**
 * Public figures whose trades the books do not have yet: placeholders by the entrance. The owner asked for members of
 * Congress and the executive branch (2026-11-26); their trade reports are being collected (task K34).
 */
export const NOT_COLLECTED: { name: string; note: string }[] = [
  { name: "Nancy Pelosi", note: "congressional trade reports, being collected" },
  { name: "Donald Trump", note: "executive financial disclosures, being collected" },
];

export const FAMOUS_BY_CIK = new Map(FAMOUS_FACES.map((face) => [face.cik, face]));
