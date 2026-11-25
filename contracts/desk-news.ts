/**
 * The desk's news files: scripts/build-desk-news.mts turns the news archive on D: (items as collected, the local
 * model's readings) into one file of stories per first-seen day and one file per registry company under
 * worker/.runs/desk-news; api/services/desk-news.ts reads them. One story = one piece of news, however many outlets
 * carried it; the first outlet we saw is its headline, the copies are its other sources.
 */
export const DESK_NEWS_SCHEMA_VERSION = 1;

export const NEWS_EVENT_LABELS: Record<string, string> = {
  earnings_results: "Results", guidance_outlook: "Outlook", analyst_action: "Analysts", mna_deal: "Deals", management_change: "Management",
  product_business: "Business", contract_partnership: "Contracts", legal_regulatory: "Legal and regulators", capital_return: "Dividends and buybacks",
  financing: "Financing", insider_ownership: "Holders and insiders", macro_policy: "Economy and policy", market_commentary: "Commentary",
  stock_move_recap: "Stock moves", event_notice: "Event notices", other: "Other",
};

/** How a story is tied to a company: the model's subject, another company the model found named, the SEC filer, a
 * ticker the wire tagged, or the company a per-company feed was asked about (such feeds also return other news). */
export type NewsTie = "subject" | "mentioned" | "filer" | "tagged" | "asked";

export interface NewsCompanyTie {
  cik: number;
  ticker: string | null;
  name: string | null;
  ties: NewsTie[];
  /** In the registry (the desk's companies). */
  registry: boolean;
}

export interface NewsSource {
  publisher: string;
  feed: string;
  url: string;
  firstSeenAt: string;
}

/** The local model's reading of the headline item (our own research product: the owner and NDA reviewers only). */
export interface NewsReading {
  subject: string;
  eventType: string;
  direction: "positive" | "negative" | "neutral" | "mixed";
  novelty: "new" | "followup" | "noise";
  fact: string;
}

export interface DeskNewsStory {
  /** The story id (the id of its first item). */
  id: string;
  title: string;
  url: string;
  publisher: string;
  feed: string;
  /** The outlet's own time; null when the feed gives none. Never later than firstSeenAt in the file. */
  publishedAt: string | null;
  /** When we first had it: the point-in-time anchor for research. */
  firstSeenAt: string;
  /** Copies seen after the first item (at most 12 listed), oldest first; `copies` counts all of them. */
  sources: NewsSource[];
  copies: number;
  companies: NewsCompanyTie[];
  /** 8-K item numbers when the story is an SEC current report. */
  secItems: string[];
  /** null while the model has not read the story (or could not). */
  reading: NewsReading | null;
}

export interface DeskNewsDay {
  schemaVersion: number;
  /** The UTC date the stories were first seen. */
  date: string;
  builtAt: string;
  stories: DeskNewsStory[];
}

export interface DeskNewsCompany {
  schemaVersion: number;
  cik: number;
  builtAt: string;
  /** The first-seen days covered, oldest first. */
  days: string[];
  stories: DeskNewsStory[];
}

/** What the News page asks for. */
export interface DeskNewsQuery {
  hours: number;
  scope: "all" | "registry" | "watchlist";
  ciks?: number[];
  event?: string;
  direction?: string;
  newOnly?: boolean;
  publisher?: string;
  search?: string;
  limit: number;
}

export interface DeskNewsPage {
  builtAt: string | null;
  hours: number;
  /** Stories in the window before the filters, and after them. */
  total: number;
  matching: number;
  read: number;
  copies: number;
  stories: DeskNewsStory[];
  /** Counts over the matching stories. */
  events: { event: string; stories: number }[];
  publishers: { publisher: string; stories: number }[];
  /** Registry companies with the most matching stories, with the model's direction counts (presentation only). */
  companies: { cik: number; ticker: string | null; name: string | null; stories: number; positive: number; negative: number }[];
  /** False when the viewer may not see the model's readings; the stories then carry none. */
  readings: boolean;
}
