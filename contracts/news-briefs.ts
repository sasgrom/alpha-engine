/**
 * News briefs for followed companies: worker/news-briefs.mts writes them, the desk reads the latest.
 *
 * One edition per company and New York weekday. The morning brief covers the news since the previous weekday's
 * close (16:00); each later update adds timed entries. Every version is appended to
 * D:/research/alpha-engine/news/briefs/<edition>/<cik>.jsonl as a complete brief (a point-in-time record of what the
 * brief said and when); the desk's copy is the latest version. The text is the local model's, checked by code: every
 * number and name must stand in the cited stories, and a part that fails shows its headlines instead.
 * Our own research product: the owner and NDA reviewers only.
 */
export const NEWS_BRIEF_SCHEMA_VERSION = 1;

export interface BriefSource { id: string; title: string; publisher: string; url: string; at: string }

export interface BriefCheck {
  /** True when every number and name of the text stands in its sources. */
  checked: boolean;
  /** What failed (numbers and names not in the sources); the text is then the first source's headline. */
  problems?: string[];
}

export interface BriefPoint extends BriefCheck {
  /** The story thread: the first story id that opened it. */
  thread: string;
  title: string;
  text: string;
  sources: BriefSource[];
  /** When the thread was first seen; earlier than the edition's window when the point continues an open story. */
  since: string;
  continues: boolean;
}

export interface BriefUpdate extends BriefCheck {
  at: string;
  thread: string;
  title: string;
  text: string;
  sources: BriefSource[];
  continues: boolean;
}

export interface NewsBrief {
  schemaVersion: number;
  kind: "morning" | "update" | "check";
  cik: number;
  ticker: string | null;
  name: string | null;
  /** The New York date of the edition. */
  edition: string;
  /** The news window: from the previous weekday's close to this version's time. */
  from: string;
  to: string;
  generatedAt: string;
  topLine: BriefCheck & { text: string; changedAt: string };
  points: BriefPoint[];
  updates: BriefUpdate[];
  /** Written by code from the desk snapshot, never by the model. */
  price: string | null;
  counts: {
    /** Stories in the window tied to the company. */
    stories: number;
    picked: number;
    /** Picked stories the model was given (at most 30 a call); the rest are listed in `others`. */
    given: number;
    skipped: Record<string, number>;
    /** Stories the reader had not read yet when the brief was written. */
    unread: number;
  };
  /** Picked stories that no point or update cites, newest first (at most 20). */
  others: BriefSource[];
  /** Every story id the model has been given in this edition. */
  inputs: string[];
  model: string;
  modelDigest: string | null;
  ollamaVersion: string | null;
  promptVersion: string;
  /** The picking rules' version (absent on the first versions of 2026-11-25, rules p1). */
  pickVersion?: string;
}

/** One company's line on the Today page. */
export interface DeskBriefLine {
  cik: number;
  ticker: string | null;
  name: string | null;
  edition: string;
  topLine: string;
  checked: boolean;
  points: number;
  updates: number;
  /** The latest change: the newest update, or the top line's time. */
  changedAt: string;
  lastUpdate: { at: string; text: string } | null;
}
