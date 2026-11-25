/**
 * Reading news items with the local model (owner's go of 2026-11-25: gemma4:12b as a scheduled job). The prompt and
 * the answer schema are the ones the bake-off measured (version 2: names only, no query ticker; 300 hand-labelled
 * items, subject 93.3%, event 79.3%, direction 79.7%, novelty 81.7%). Do not change their text without a new
 * bake-off: the prompt hash is stored with every answer.
 * The model names companies as written; code finds the SEC identity (news-companies.ts).
 */
import { createHash } from "node:crypto";
import { CompanyIndex, explicitTickers, nameWords } from "./news-companies";

export const EXTRACT_MODEL = "gemma4:12b";
export const EVENTS = ["earnings_results", "guidance_outlook", "analyst_action", "mna_deal", "management_change", "product_business", "contract_partnership",
  "legal_regulatory", "capital_return", "financing", "insider_ownership", "macro_policy", "market_commentary", "stock_move_recap", "event_notice", "other"] as const;
export const DIRECTIONS = ["positive", "negative", "neutral", "mixed"] as const;
export const NOVELTY = ["new", "followup", "noise"] as const;

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "the company the item is mainly about, as named in the item, or '-' if none" },
    mentioned: { type: "array", items: { type: "string" }, description: "every other company named in the item" },
    eventType: { type: "string", enum: [...EVENTS] },
    direction: { type: "string", enum: [...DIRECTIONS] },
    novelty: { type: "string", enum: [...NOVELTY] },
    fact: { type: "string", description: "the news in at most 20 words" },
  },
  required: ["subject", "mentioned", "eventType", "direction", "novelty", "fact"],
};

// verbatim as measured in the bake-off (including its two "subject:" lines)
export const EXTRACT_SYSTEM = `You label financial news items for a stock research system. Answer only with the JSON object.
subject: the one company the item is mainly about (its common name). Use '-' when the item is about the economy, a market, a sector, several companies equally, a private person, or nothing tradable.
subject: write the company's name as the item names it (no ticker). mentioned: every other company named, by name.
eventType, one of:
 earnings_results (reported results, earnings call transcripts and slides), guidance_outlook (forecasts, targets, outlook changes),
 analyst_action (a rating, price target or estimate change by a bank, broker or rating agency), mna_deal (mergers, acquisitions, takeovers, spin-offs, disposals),
 management_change (executives, directors, succession, executive pay), product_business (products, launches, operations, strategy),
 contract_partnership (orders, contracts, customers, partnerships), legal_regulatory (courts, regulators, approvals, sanctions, restatements),
 capital_return (dividends, buybacks), financing (debt, loans, credit facilities, share sales), insider_ownership (insider or major holder trades, fund holdings),
 macro_policy (central banks, official statistics, government policy), market_commentary (opinion, analysis, valuation, previews, comparisons, lists),
 stock_move_recap (why a stock or market moved), event_notice (conferences, webcasts, presentations, meeting dates), other.
direction: how the item reflects on the subject (for a stock-move recap: the move): positive, negative, neutral, or mixed.
novelty: new (the item reports an event or announcement), followup (analysis, opinion, recap, transcript, preview of something known), noise (no bearing on any stock: personal finance, promotion, data pages, general interest).
fact: the news in at most 20 words, in English.`;

export const PROMPT_VERSION = createHash("sha256").update(EXTRACT_SYSTEM).update(JSON.stringify(EXTRACT_SCHEMA)).digest("hex").slice(0, 16);

export interface NewsItemRow { id: string; feed: string; publisher: string; title: string; summary?: string | null; firstSeenAt: string; storyId: string; copyOfEarlierStory: boolean }
export interface Label { subject: string; mentioned: string[]; eventType: string; direction: string; novelty: string; fact: string }
export interface Resolved { cik: number; tickers: string[]; how: string }

/** The item's text as the bake-off gave it: the summary without a repeated title, whitespace folded, 700 characters. */
export function itemText(item: Pick<NewsItemRow, "title" | "summary">): string {
  let summary = (item.summary ?? "").replace(/\s+/g, " ");
  if (summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 40))) summary = summary.slice(item.title.length).replace(/^[ .-]+|[ .-]+$/g, "");
  return summary.slice(0, 700);
}
export const userMessage = (item: NewsItemRow) => `Source: ${item.publisher} (${item.feed})\nTitle: ${item.title}\nText: ${itemText(item) || "-"}`;

/** The model's answer checked against the schema; null when it is not a complete, valid label. */
export function parseAnswer(content: string): Label | null {
  let value: any;
  try { value = JSON.parse(content); } catch { return null; }
  if (!value || typeof value !== "object" || typeof value.subject !== "string" || typeof value.fact !== "string" || !Array.isArray(value.mentioned)) return null;
  if (!EVENTS.includes(value.eventType) || !DIRECTIONS.includes(value.direction) || !NOVELTY.includes(value.novelty)) return null;
  return { subject: value.subject.trim(), mentioned: value.mentioned.filter((name: unknown) => typeof name === "string" && name.trim()).map((name: string) => name.trim()),
    eventType: value.eventType, direction: value.direction, novelty: value.novelty, fact: value.fact.trim() };
}

/** Items still to read: one per story (copies are skipped, the first copy carries the story), newest first; items
 * for which `first` holds (tied to a followed company) come before all others. */
export function pickItems(rows: NewsItemRow[], done: Set<string>, limit: number, first: (row: NewsItemRow) => boolean = () => false): NewsItemRow[] {
  const rank = new Map<string, number>();
  const todo = rows.filter(row => !row.copyOfEarlierStory && !done.has(row.id));
  for (const row of todo) rank.set(row.id, first(row) ? 0 : 1);
  return todo.sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || b.firstSeenAt.localeCompare(a.firstSeenAt) || a.id.localeCompare(b.id)).slice(0, limit);
}

/** The ties an item has before the model reads it: the SEC filer, tickers the wire tagged, the company a per-company
 * feed was asked about (also when that feed returned an item stored earlier, from the mentions file). */
export interface TieInputs { query?: { cik?: number } | null; ciks?: number[]; tickers?: string[] }
export function tiedCiks(item: TieInputs, tickerToCik: Map<string, number>, mentioned: number[] = []): number[] {
  const ciks = new Set<number>([...(item.ciks ?? []), ...mentioned]);
  if (item.query?.cik) ciks.add(item.query.cik);
  for (const ticker of item.tickers ?? []) { const cik = tickerToCik.get(ticker.toUpperCase().replace("-", ".")); if (cik) ciks.add(cik); }
  return [...ciks];
}

/** A name to an SEC identity: a clear match by name, else a ticker the text states whose company shares a word with the name. */
export function resolveName(index: CompanyIndex, name: string, text: string): Resolved | null {
  if (!name || name === "-") return null;
  const byName = index.resolve(name);
  if (byName) return { cik: byName.cik, tickers: byName.tickers, how: byName.match };
  const words = new Set(nameWords(name));
  for (const ticker of explicitTickers(text)) {
    const hit = index.ticker(ticker).find(entry => entry.names.some(filed => nameWords(filed).some(word => words.has(word))));
    if (hit) return { cik: hit.cik, tickers: hit.tickers, how: "stated-ticker" };
  }
  return null;
}
