/**
 * GDELT 2.1 Global Knowledge Graph files (Claude's attempt, owner's permission of 2026-11-25, AGENTS.md section 3).
 *
 * Only the static file server is used, never the DOC/query API that throttled the earlier collector: GDELT writes one
 * GKG file every 15 minutes at a fixed address (`<YYYYMMDDHHMMSS>.gkg.csv.zip`), and `lastupdate.txt` names the newest
 * with its size and MD5. A missed slot is therefore visible and can be fetched later at the same address.
 * The English stream only (the translingual stream is a separate file set, not asked).
 */
import { CompanyIndex, type CompanyEntry } from "./news-companies";

export const GDELT_BASE = "https://data.gdeltproject.org/gdeltv2/";
export const SLOT_MS = 15 * 60_000;

export interface GkgFileRef { size: number; md5: string; url: string; stamp: string }
/** The GKG line of lastupdate.txt (one line per file kind: size, MD5, address). */
export function parseLastUpdate(text: string): GkgFileRef | null {
  for (const line of text.split("\n")) {
    const [size, md5, url] = line.trim().split(/\s+/);
    const stamp = url?.match(/\/(\d{14})\.gkg\.csv\.zip$/)?.[1];
    if (stamp && /^[0-9a-f]{32}$/.test(md5 ?? "") && Number(size) > 0) return { size: Number(size), md5, url: `${GDELT_BASE}${stamp}.gkg.csv.zip`, stamp };
  }
  return null;
}

const stampMs = (stamp: string) => Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));
export const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
export const stampIso = (stamp: string) => new Date(stampMs(stamp)).toISOString();
/** The 15-minute slots after `from` up to and including `to`. */
export function slotsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = stampMs(from) + SLOT_MS; ms <= stampMs(to); ms += SLOT_MS) out.push(stampOf(ms));
  return out;
}

export interface GkgRecord {
  id: string;
  /** GDELT's time for the record (UTC): when it processed the article, at most 15 minutes after it found it. */
  gdeltAt: string;
  source: string;
  url: string;
  title: string | null;
  /** Average tone (positive minus negative words, per 100 words) and the share of positive and negative words. */
  tone: number | null;
  positive: number | null;
  negative: number | null;
  /** The article's word count (the tone's last field). */
  words: number | null;
  organizations: string[];
  themes: string[];
}

const number = (text: string | undefined) => { const value = Number(text); return text !== undefined && text !== "" && Number.isFinite(value) ? value : null; };
const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x2026;/g, "…").replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Tab-separated GKG 2.1 rows (no header, no quoting). Field numbers as in the GKG 2.1 codebook. */
export function parseGkg(text: string): GkgRecord[] {
  const out: GkgRecord[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 27 || !f[0] || !/^\d{14}$/.test(f[1])) continue;
    const tone = (f[15] ?? "").split(",");
    const title = f[26]?.match(/<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/)?.[1];
    out.push({
      id: f[0], gdeltAt: stampIso(f[1]), source: f[3], url: f[4], title: title ? unescape(title).trim() : null,
      tone: number(tone[0]), positive: number(tone[1]), negative: number(tone[2]), words: number(tone[6]),
      organizations: [...new Set((f[13] ?? "").split(";").map(entry => entry.split(",")[0].trim()).filter(Boolean))],
      themes: [...new Set((f[7] ?? "").split(";").map(entry => entry.split(",")[0].trim()).filter(Boolean))].slice(0, 40),
    });
  }
  return out;
}

export interface GkgCompanyMatch { cik: number; ticker: string | null; organization: string; match: string }
/** The companies of our index a record's organizations resolve to (CompanyIndex.resolve: one clear candidate or none). */
export function companiesOf(record: GkgRecord, index: CompanyIndex): GkgCompanyMatch[] {
  const out = new Map<number, GkgCompanyMatch>();
  for (const organization of record.organizations) {
    if (organization.length < 3) continue;
    const found = index.resolve(organization);
    if (found && !out.has(found.cik)) out.set(found.cik, { cik: found.cik, ticker: found.tickers[0] ?? null, organization, match: found.match });
  }
  return [...out.values()];
}
export const buildIndex = (entries: CompanyEntry[]) => new CompanyIndex(entries);
