/**
 * Schedule 13D cover pages: who reports a stake of more than 5% with the intent to influence the company (activists,
 * strategic holders), how many shares and what percent of the class. Read from the filings the nightly SEC fetch caches
 * (worker/cache/edgar/<cik>/<accession>.htm): since December 2024 SEC renders the structured form ("Name of reporting
 * person ... Percent of class represented by amount in Row (11) 9.4 %"); older filings are text or HTML with the same
 * numbered rows in capitals. A filing may carry several cover pages, one per reporting person of the group.
 */

export interface Cover { name: string; shares: number | null; percent: number | null }
export interface Schedule13D {
  cusip: string | null;
  /** The issuer's name as the filing states it, before "(Name of Issuer)". */
  issuer: string | null;
  covers: Cover[];
}

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", "#8217": "'", "#8220": '"', "#8221": '"', "#160": " " };
/** Text of an HTML or text filing: tags out, entities decoded, white space collapsed. */
export function filingText(raw: string): string {
  return raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (whole, code: string) => ENTITIES[code.toLowerCase()] ?? (code.startsWith("#") ? String.fromCharCode(Number(code.slice(1))) : whole))
    .replace(/\s+/g, " ")
    .trim();
}

const number = (text: string | undefined) => {
  if (!text) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

/** The cover pages of a 13D: each "Name(s) of reporting person(s)" up to the next one. */
export function parse13D(raw: string): Schedule13D {
  const text = filingText(raw);
  const cusip = text.match(/CUSIP\s*(?:No\.?|Number)?\s*[:.]?\s*([0-9A-Z]{6}[0-9A-Z]{2,3})\b/i)?.[1]?.toUpperCase() ?? null;
  const issuer = text.match(/(?:SCHEDULE 13D|Amendment No\.?\s*\d+\)?)\s*(?:\(Rule[^)]*\))?\s*(?:Under the Securities Exchange Act of 1934)?\s*(?:\(Amendment No\.?\s*\d*\)\*?)?\s*(.{3,120}?)\s*\(Name of Issuer\)/i)?.[1]?.trim() ?? null;
  const parts = text.split(/\bNames?\s+of\s+reporting\s+persons?\b\.?/i).slice(1);
  const covers: Cover[] = [];
  for (const part of parts) {
    const name = cleanName(part.split(/\s*\(?\b2\s*\)?\s*\.?\s*\(?\s*Check\s+the\s+appropriate/i)[0]);
    const shares = number(part.match(/Aggregate\s+amount\s+beneficially\s+owned\s+by\s+each\s+reporting\s+person\s*:?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);
    const percent = number(part.match(/Percent\s+of\s+class\s+represented\s+by\s+amount\s+in\s+row\s*\(?11\)?\s*:?\s*(?:Approximately\s*)?([\d.]+)\s*%/i)?.[1]);
    if (name && !/^see\b/i.test(name)) covers.push({ name, shares, percent: percent !== null && percent <= 100 ? percent : null });
  }
  return { cusip, issuer, covers };
}

/**
 * A reporting person's name as the cover writes it, without the older forms' row caption ("S.S. or I.R.S.
 * Identification Nos. of Above Persons (Entities Only)"), tax numbers, and stray marks before it.
 */
export function cleanName(raw: string): string {
  return raw
    .replace(/^[\s;:/_\-.()]*(?:S\.?\s*S\.?\s*)?(?:OR\s+)?(?:I\.?\s*R\.?\s*S\.?\s*)?I[ND]{1,2}ENTIFICATION\s+NOS?\.?\s+OF\s+(?:THE\s+)?ABOVE\s+PERSONS?\s*(?:\(\s*ENTITIES\s+ONLY\s*\))?\s*[:.]?/i, "")
    // a tax-number caption or a rule after the name ("I.R.S. Identification No.: 36-4245844", "IRS identification number
    // not applicable", "(IRS I.D. #)", "-----")
    .replace(/\s+(?:\(\s*IRS\b|I\.\s*R\.\s*S\.|IRS\s+(?:I\.?\s*D|identification))[\s\S]*$/i, "")
    .replace(/\s*[-–—_=]{3,}[\s\S]*$/, "")
    .replace(/\b\d{2}-\s?\d{7}\b/g, "")
    .replace(/^[\s;:/_\-.()]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** The group's stake: the largest share count and percent any of its cover pages states (members overlap, never add). */
export function stakeOf(filing: Schedule13D): { lead: string | null; shares: number | null; percent: number | null } {
  const lead = filing.covers[0]?.name ?? null;
  const shares = filing.covers.reduce<number | null>((max, cover) => (cover.shares !== null && (max === null || cover.shares > max) ? cover.shares : max), null);
  const percent = filing.covers.reduce<number | null>((max, cover) => (cover.percent !== null && (max === null || cover.percent > max) ? cover.percent : max), null);
  return { lead, shares, percent };
}

/** A reporting person's name as a key across filings: lower case, without legal suffixes and fund numbering. */
export function filerKey(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, " ").replace(/\b(l\s?p|llc|ltd|limited|inc|corp|corporation|co|plc|gp|the|master|fund|funds|partners|management|capital|advisors|advisers|holdings|group|i{1,3}|iv|v|\d+)\b/g, " ").replace(/\s+/g, " ").trim() || name.toLowerCase();
}
