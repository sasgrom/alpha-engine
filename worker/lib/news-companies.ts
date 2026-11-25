/**
 * Company names in news → SEC identities (owner, 2026-11-25: the model names the companies; code resolves them, because
 * a model guesses tickers and code looks them up). The index joins the SEC's company list with tickers, our registry
 * and the Russell 1000 identities (with former names). Resolution returns ranked candidates; it never picks one of two
 * equally good matches.
 */

export interface CompanyEntry { cik: number; tickers: string[]; names: string[]; status?: string }
export interface Candidate { cik: number; tickers: string[]; name: string; match: "ticker" | "exact" | "words" | "prefix"; score: number }

const LEGAL = new Set(["the", "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited", "plc", "nv", "sa", "ag", "se", "llc", "lp", "holdings", "holding", "group", "de", "del", "md", "new", "cos", "class", "a", "b", "c", "common", "stock", "shares", "ordinary", "adr", "ads"]);
/** A company name as a set of words: lower case, no punctuation, no legal suffixes or articles, order kept. */
export function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(word => word && !LEGAL.has(word));
}
export const nameKey = (name: string) => nameWords(name).join(" ");
const setKey = (name: string) => [...new Set(nameWords(name))].sort().join(" ");

/** Brand names the press uses that differ from the filer's name (extend as cases show up). */
export const ALIASES: Record<string, string> = { google: "GOOGL", facebook: "META", "jpmorgan": "JPM", "j p morgan": "JPM", "berkshire": "BRK.B", "coca cola": "KO", "exxon": "XOM", "walmart": "WMT", "p and g": "PG", "procter": "PG", "j and j": "JNJ" };

/** Tickers the text states with an exchange: "(NASDAQ: ADI)", "NYSE:IP", "(Nasdaq: ANT)". */
export function explicitTickers(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/\b(?:NASDAQ|Nasdaq|NYSE(?: American| Arca)?|AMEX|Cboe|CBOE|OTCQX|OTCQB)\s*:\s*([A-Z][A-Z0-9]{0,5}(?:[.-][A-Z])?)\b/g)) out.add(match[1].replace("-", "."));
  return [...out];
}

export class CompanyIndex {
  private readonly byTicker = new Map<string, CompanyEntry[]>();
  private readonly byKey = new Map<string, CompanyEntry[]>();
  private readonly bySet = new Map<string, CompanyEntry[]>();
  private readonly byFirst = new Map<string, CompanyEntry[]>();
  constructor(readonly entries: CompanyEntry[]) {
    const push = (map: Map<string, CompanyEntry[]>, key: string, entry: CompanyEntry) => { if (!key) return; const list = map.get(key) ?? []; if (!list.includes(entry)) list.push(entry); map.set(key, list); };
    for (const entry of entries) {
      for (const ticker of entry.tickers) push(this.byTicker, ticker.toUpperCase().replace("-", "."), entry);
      for (const name of entry.names) { push(this.byKey, nameKey(name), entry); push(this.bySet, setKey(name), entry); push(this.byFirst, nameWords(name)[0] ?? "", entry); }
    }
  }
  ticker(ticker: string): CompanyEntry[] { return this.byTicker.get(ticker.toUpperCase().replace("-", ".")) ?? []; }

  /** Ranked candidates for a name as written in the news (and, when given, a ticker the text states). */
  candidates(name: string, statedTicker: string | null = null, limit = 8): Candidate[] {
    const out = new Map<number, Candidate>();
    const add = (entry: CompanyEntry, match: Candidate["match"], score: number) => {
      const previous = out.get(entry.cik);
      if (!previous || previous.score < score) out.set(entry.cik, { cik: entry.cik, tickers: entry.tickers, name: entry.names[0], match, score });
    };
    if (statedTicker) for (const entry of this.ticker(statedTicker)) add(entry, "ticker", 1);
    const key = nameKey(name), alias = ALIASES[key];
    if (alias) for (const entry of this.ticker(alias)) add(entry, "exact", 0.95);
    for (const entry of this.byKey.get(key) ?? []) add(entry, "exact", 0.9);
    for (const entry of this.bySet.get(setKey(name)) ?? []) add(entry, "words", 0.8);
    // a short press name ("Analog Devices", "Aflac") against a longer filer name: every press word is in the filer name,
    // in order, starting with its first word
    const words = nameWords(name);
    if (words.length) for (const entry of this.byFirst.get(words[0]) ?? []) {
      for (const filed of entry.names) {
        const target = nameWords(filed);
        if (target.length >= words.length && words.every((word, i) => target[i] === word)) add(entry, "prefix", 0.5 + 0.3 * words.length / target.length);
      }
    }
    return [...out.values()].sort((a, b) => b.score - a.score || a.cik - b.cik).slice(0, limit);
  }

  /** The one company a name stands for, or null when no candidate is clearly best (the caller keeps the candidates). */
  resolve(name: string, statedTicker: string | null = null): Candidate | null {
    const list = this.candidates(name, statedTicker, 3);
    if (!list.length) return null;
    if (list.length > 1 && list[1].score >= list[0].score - 0.05) return null;
    return list[0].score >= 0.6 ? list[0] : null;
  }
}
