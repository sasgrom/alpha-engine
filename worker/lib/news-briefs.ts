/**
 * News briefs for followed companies (owner's go of 2026-11-25): a morning brief of the news since the previous close,
 * then short timed updates when something new comes in. Pure: worker/news-briefs.mts reads and writes the files.
 *
 * The model writes only from picked stories, every sentence names its stories, and code checks every number and name
 * against those stories' own text before a brief is shown; a point that fails shows its headlines instead.
 */
import { createHash } from "node:crypto";
import { NEWS_EVENT_LABELS, type DeskNewsStory } from "../../contracts/desk-news";
import type { BriefCheck, BriefPoint, BriefSource, BriefUpdate, NewsBrief } from "../../contracts/news-briefs";

/** Event kinds whose follow-ups still matter (an earnings call transcript, a rating change on known news). */
export const MATERIAL_FOLLOWUP = new Set(["earnings_results", "guidance_outlook", "analyst_action", "mna_deal", "legal_regulatory", "management_change"]);

export type SkipReason = "old" | "not about it" | "noise" | "commentary" | "holdings" | "follow-up" | "unread";
/** The picking rules' version, stored with every brief (p2, 2026-11-25: holdings, question headlines, numbered lists
 * and results stories between reports left out). */
export const PICK_VERSION = "p2";
/** A headline that asks is an opinion piece ("Can It Boost Shareholder Returns?"); a numbered list is commentary. */
const OPINION_TITLE = /\?\s*["”’']?\s*$|\b(top|best) \d+\b|^\d+ (stocks|reasons|things|ways)\b/i;
/** A story the outlet published this long before the window opened is not news for the brief, even when we first saw it later. */
export const OLD_MARGIN_HOURS = 6;
export interface Picked { picked: DeskNewsStory[]; skipped: Record<SkipReason, number>; unread: DeskNewsStory[] }

/**
 * The stories worth a brief for one company. About it: the model's subject, the SEC filer, or a ticker the wire
 * tagged when the model did not name another company as the subject. Kept: an SEC filing always; else news the model
 * calls new, or a follow-up of a material kind; commentary (also question headlines and numbered lists), holdings
 * and insider trades, and noise are counted, not shown. With `from`, a story
 * published more than OLD_MARGIN_HOURS before it is counted as old.
 */
export interface EarningsDates { lastEarnings?: string | null; nextEarnings?: string | null }

/** A results story while the company is between reports (last more than 10 days ago, next more than 14 days ahead) is
 * commentary on known results, not news; a real early report still comes as an SEC filing, which is always picked. */
export function staleResults(story: DeskNewsStory, dates: EarningsDates | undefined): boolean {
  if (story.reading?.eventType !== "earnings_results" || !dates?.lastEarnings || !dates.nextEarnings) return false;
  const day = Date.parse((story.publishedAt ?? story.firstSeenAt).slice(0, 10));
  return day - Date.parse(dates.lastEarnings) > 10 * 86_400_000 && Date.parse(dates.nextEarnings) - day > 14 * 86_400_000;
}

export function pickStories(stories: DeskNewsStory[], cik: number, from?: string, dates?: EarningsDates): Picked {
  const skipped: Record<SkipReason, number> = { old: 0, "not about it": 0, noise: 0, commentary: 0, holdings: 0, "follow-up": 0, unread: 0 };
  const picked: DeskNewsStory[] = [], unread: DeskNewsStory[] = [];
  const oldBefore = from ? new Date(Date.parse(from) - OLD_MARGIN_HOURS * 3_600_000).toISOString() : null;
  for (const story of stories) {
    const tie = story.companies.find(company => company.cik === cik);
    if (!tie) continue;
    if (oldBefore && story.publishedAt && story.publishedAt < oldBefore) { skipped.old++; continue; }
    if (tie.ties.includes("filer")) { picked.push(story); continue; }
    const reading = story.reading;
    if (!reading) { skipped.unread++; unread.push(story); continue; }
    const subjectIsOther = story.companies.some(company => company.cik !== cik && company.ties.includes("subject"));
    const about = tie.ties.includes("subject") || (tie.ties.includes("tagged") && !subjectIsOther);
    if (!about) { skipped["not about it"]++; continue; }
    if (reading.novelty === "noise") { skipped.noise++; continue; }
    if (reading.eventType === "market_commentary" || OPINION_TITLE.test(story.title) || staleResults(story, dates)) { skipped.commentary++; continue; }
    // fund holdings, fund flows and insider trades: written by bots from filings; the company page shows them from
    // our own 13F and insider standards
    if (reading.eventType === "insider_ownership") { skipped.holdings++; continue; }
    if (reading.novelty === "followup" && !MATERIAL_FOLLOWUP.has(reading.eventType)) { skipped["follow-up"]++; continue; }
    picked.push(story);
  }
  return { picked, skipped, unread };
}

// ---- timing, New York time: a brief per weekday (Monday's covers the weekend); holidays are written like any day

const ET = "America/New_York";
export const MORNING = 8 * 60 + 45, MORNING_WAIT_UNTIL = 9 * 60 + 15, CLOSE = 16 * 60, UPDATES_UNTIL = 20 * 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etClock(date: Date): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The instant whose New York wall clock reads `date` at `minutes` past midnight. */
export function etInstant(date: string, minutes: number): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  let guess = wall + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) { const clock = etClock(new Date(guess)); guess -= Date.parse(`${clock.date}T00:00:00Z`) + clock.minutes * 60_000 - wall; }
  return new Date(guess);
}

export function previousWeekday(date: string): string {
  let time = Date.parse(`${date}T12:00:00Z`);
  do time -= 86_400_000; while ([0, 6].includes(new Date(time).getUTCDay()));
  return new Date(time).toISOString().slice(0, 10);
}

export type BriefAction =
  | { kind: "morning"; edition: string; from: string; waitForReader: boolean }
  | { kind: "update"; edition: string }
  | { kind: "none"; reason: string };

/** What a run does for a company: the morning brief once a weekday from 08:45 (it waits for the reader until 09:15),
 * then updates until 20:00; later news waits for the next morning. */
export function briefAction(now: Date, hasMorning: boolean): BriefAction {
  const clock = etClock(now);
  if (clock.weekday === 0 || clock.weekday === 6) return { kind: "none", reason: "weekend: the news waits for Monday's brief" };
  if (clock.minutes < MORNING) return { kind: "none", reason: "before 08:45 New York time" };
  if (!hasMorning) return { kind: "morning", edition: clock.date, from: etInstant(previousWeekday(clock.date), CLOSE).toISOString(), waitForReader: clock.minutes < MORNING_WAIT_UNTIL };
  if (clock.minutes >= UPDATES_UNTIL) return { kind: "none", reason: "after 20:00 New York time: the news waits for the morning brief" };
  return { kind: "update", edition: clock.date };
}

// ---- the model's two tasks; their text is hashed into BRIEF_PROMPT_VERSION, stored with every brief

export const BRIEF_MODEL = "gemma4:12b";
export const MAX_ITEMS = 30;

export const MORNING_SCHEMA = {
  type: "object",
  properties: {
    topLine: { type: "string", description: "the most important news, at most 15 words" },
    points: { type: "array", maxItems: 4, items: { type: "object", properties: {
      thread: { type: "string", description: "the id of the open story this continues (T1, T2 ...), or 'new'" },
      title: { type: "string", description: "at most 8 words" },
      text: { type: "string", description: "one or two sentences, at most 40 words" },
      items: { type: "array", items: { type: "string" }, description: "the ids of the items the point is taken from (S1, S2 ...)" },
    }, required: ["thread", "title", "text", "items"] } },
  },
  required: ["topLine", "points"],
};

export const MORNING_SYSTEM = `You write a short morning news brief about one company for an investor, from the news items given.
Use only what the items state. Never add a number, name, cause, date or forecast that the items do not state. If items disagree, say so.
Group the items that report the same event into one point. Leave out items that only repeat a point or add nothing,
and routine items: daily fund flows, counts of funds buying or selling, small insider trades, valuation-model scores, opinion pieces.
topLine: the most important news in at most 15 words.
Write in sentence case: a capital letter only to start a sentence and for names.
points: at most 4, the most important first. title: at most 8 words. text: one or two plain sentences, at most 40 words.
items: the ids of every item the point is taken from. thread: the id of the open story the point continues, from the list given, or 'new'.
Answer only with the JSON object.`;

export const UPDATE_SCHEMA = {
  type: "object",
  properties: {
    updates: { type: "array", maxItems: 3, items: { type: "object", properties: {
      thread: { type: "string", description: "the id of the point or open story this adds to (T1, T2 ...), or 'new'" },
      title: { type: "string", description: "for a new story: at most 8 words; else ''" },
      text: { type: "string", description: "one sentence, at most 30 words" },
      items: { type: "array", items: { type: "string" } },
    }, required: ["thread", "title", "text", "items"] } },
    topLine: { type: "string", description: "a new top line only when the new items change the most important news; else ''" },
  },
  required: ["updates", "topLine"],
};

export const UPDATE_SYSTEM = `You keep a company's news brief up to date during the day. You get today's brief and the news items that came in since.
Use only what the new items state. Never add a number, name, cause, date or forecast that the items do not state.
Write in sentence case: a capital letter only to start a sentence and for names.
updates: at most 3, one per event the new items report that the brief does not already say; none when they only repeat it.
thread: the id of the brief's point or open story the update adds to, or 'new'. title: for 'new' at most 8 words, else ''.
text: one plain sentence, at most 30 words. items: the ids of every new item the update is taken from.
topLine: a new top line (at most 15 words) only when the new items change the most important news; else ''.
Answer only with the JSON object.`;

export const BRIEF_PROMPT_VERSION = createHash("sha256").update(MORNING_SYSTEM).update(JSON.stringify(MORNING_SCHEMA)).update(UPDATE_SYSTEM).update(JSON.stringify(UPDATE_SCHEMA)).digest("hex").slice(0, 16);

/** A picked story as the model and the checks see it: our own text of it is its headline and the feed's summary. */
export interface BriefInput { story: DeskNewsStory; summary: string }
export interface OpenThread { id: string; title: string; text: string; lastAt: string; since: string }

const nyTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const sourceText = (input: BriefInput) => `${input.story.title}\n${input.summary}`;

/** The items as the model reads them: S1 ... in order, each with time, outlet, kind, tone and its own text. */
export function itemsBlock(inputs: BriefInput[]): string {
  return inputs.map((input, i) => {
    const reading = input.story.reading;
    const kind = input.story.secItems.length ? `SEC filing, items ${input.story.secItems.join(", ")}` : reading ? `${NEWS_EVENT_LABELS[reading.eventType] ?? reading.eventType}, ${reading.direction}` : "unread";
    const outlets = input.story.copies ? ` (+${input.story.copies} other outlet${input.story.copies > 1 ? "s" : ""})` : "";
    return `S${i + 1} [${nyTime(input.story.publishedAt ?? input.story.firstSeenAt)} ET, ${input.story.publisher}${outlets}, ${kind}]\n${input.story.title}${input.summary ? `\n${input.summary.slice(0, 500)}` : ""}`;
  }).join("\n\n");
}
/** Threads are shown to the model as T1, T2 ... (labels, never our ids). */
const threadsBlock = (threads: OpenThread[]) => threads.length ? threads.map((thread, i) => `T${i + 1} (last ${nyTime(thread.lastAt)} ET): ${thread.title}.${thread.text ? ` ${thread.text}` : ""}`).join("\n") : "none";

export function morningMessage(company: string, threads: OpenThread[], inputs: BriefInput[]): string {
  return `Company: ${company}\n\nOpen stories of the last three days:\n${threadsBlock(threads)}\n\nNews items since the previous close:\n\n${itemsBlock(inputs)}`;
}
/** For an update the open threads are today's points first, then the older open stories. */
export function updateMessage(company: string, topLine: string, threads: OpenThread[], inputs: BriefInput[]): string {
  return `Company: ${company}\n\nToday's brief, top line: ${topLine}\nIts points and the other open stories:\n${threadsBlock(threads)}\n\nNew items since the brief:\n\n${itemsBlock(inputs)}`;
}

// ---- the model's answers to checked brief parts

export interface AnswerPart { thread: string; title: string; text: string; items: string[] }
export interface MorningAnswer { topLine: string; points: AnswerPart[] }
export interface UpdateAnswer { topLine: string; updates: AnswerPart[] }

const isPart = (value: any): value is AnswerPart => value && typeof value.thread === "string" && typeof value.title === "string" && typeof value.text === "string" && Array.isArray(value.items);
const cleanPart = (part: AnswerPart): AnswerPart => ({ thread: part.thread.trim(), title: part.title.trim(), text: part.text.trim(), items: part.items.filter(item => typeof item === "string") });
export function parseMorning(content: string): MorningAnswer | null {
  let value: any;
  try { value = JSON.parse(content); } catch { return null; }
  if (!value || typeof value.topLine !== "string" || !Array.isArray(value.points) || !value.points.every(isPart)) return null;
  return { topLine: value.topLine.trim(), points: value.points.slice(0, 4).map(cleanPart) };
}
export function parseUpdate(content: string): UpdateAnswer | null {
  let value: any;
  try { value = JSON.parse(content); } catch { return null; }
  if (!value || typeof value.topLine !== "string" || !Array.isArray(value.updates) || !value.updates.every(isPart)) return null;
  return { topLine: value.topLine.trim(), updates: value.updates.slice(0, 3).map(cleanPart) };
}

export const sourceOf = (input: BriefInput): BriefSource => ({ id: input.story.id, title: input.story.title, publisher: input.story.publisher, url: input.story.url, at: input.story.publishedAt ?? input.story.firstSeenAt });

/** S-labels to the given items (unknown labels and repeats dropped). */
export function citedInputs(labels: string[], inputs: BriefInput[]): BriefInput[] {
  const out: BriefInput[] = [];
  for (const label of labels) {
    const match = /^S(\d+)$/i.exec(label.trim());
    const input = match ? inputs[Number(match[1]) - 1] : undefined;
    if (input && !out.includes(input)) out.push(input);
  }
  return out;
}

/** A model-written title and text checked against the cited items; on a failure the first item's headline stands. */
export interface CheckContext { names: string[]; ordinary: Set<string> }
export function checkedPart(title: string, text: string, cited: BriefInput[], context: CheckContext): BriefCheck & { title: string; text: string } {
  const sources = cited.map(sourceText);
  const result = checkAgainst(`${title}. ${text}`, sources, context.names, context.ordinary);
  if (result.ok && title) return { title, text, checked: true };
  const problems = [...result.numbers.map(value => `number ${value} not in the sources`), ...result.names.map(name => `name ${name} not in the sources`), ...(title ? [] : ["no title"])];
  return { title: cited[0].story.title, text: "", checked: false, problems };
}

function threadOf(label: string, threads: OpenThread[], cited: BriefInput[]): { thread: string; continues: boolean; since: string } {
  const match = /^T(\d+)$/i.exec(label);
  const open = match ? threads[Number(match[1]) - 1] : undefined;
  const earliest = cited.map(input => input.story.publishedAt ?? input.story.firstSeenAt).sort()[0];
  return open ? { thread: open.id, continues: true, since: open.since < earliest ? open.since : earliest } : { thread: cited[0].story.id, continues: false, since: earliest };
}

export function buildPoints(answer: MorningAnswer, inputs: BriefInput[], threads: OpenThread[], context: CheckContext): BriefPoint[] {
  const points: BriefPoint[] = [];
  for (const part of answer.points) {
    const cited = citedInputs(part.items, inputs);
    if (!cited.length) continue;   // a point without a valid source is not shown
    const where = threadOf(part.thread, threads, cited);
    if (points.some(point => point.thread === where.thread)) continue;
    points.push({ ...where, ...checkedPart(part.title, part.text, cited, context), sources: cited.map(sourceOf) });
  }
  return points;
}

export function buildUpdates(answer: UpdateAnswer, inputs: BriefInput[], threads: OpenThread[], context: CheckContext, at: string): BriefUpdate[] {
  const updates: BriefUpdate[] = [];
  for (const part of answer.updates) {
    const cited = citedInputs(part.items, inputs);
    if (!cited.length) continue;
    const where = threadOf(part.thread, threads, cited);
    const thread = threads.find(open => open.id === where.thread);
    // an update to a known thread carries no title of its own: it shows the thread's
    const checked = checkedPart(where.continues ? thread!.title : part.title, part.text, cited, context);
    if (where.continues && checked.checked) checked.title = thread!.title;
    updates.push({ at, thread: where.thread, continues: where.continues, ...checked, sources: cited.map(sourceOf) });
  }
  return updates;
}

/** The top line, checked against everything the points cite; on a failure the first point's title stands. */
export function checkedTopLine(text: string, cited: BriefInput[], context: CheckContext, fallback: string): BriefCheck & { text: string } {
  const result = checkAgainst(text, cited.map(sourceText), context.names, context.ordinary);
  if (result.ok && text) return { text, checked: true };
  return { text: fallback, checked: false, problems: [...result.numbers.map(value => `number ${value} not in the sources`), ...result.names.map(name => `name ${name} not in the sources`), ...(text ? [] : ["empty"])] };
}

/** Threads still open: those with news in the last 72 hours, from the latest version of each recent edition. */
export function openThreads(briefs: NewsBrief[], now: Date, limit = 8): OpenThread[] {
  const byId = new Map<string, OpenThread>();
  const parts = briefs.flatMap(brief => [...brief.points.map(point => ({ ...point, at: brief.generatedAt })), ...brief.updates]);
  for (const part of parts) {
    const lastAt = part.sources.map(source => source.at).sort().at(-1) ?? part.at;
    const known = byId.get(part.thread);
    const since = "since" in part ? part.since : lastAt;
    if (!known) byId.set(part.thread, { id: part.thread, title: part.title, text: part.text, lastAt, since });
    else {
      if (lastAt >= known.lastAt) { known.lastAt = lastAt; if (part.text) known.text = part.text; if (!part.continues) known.title = part.title; }
      if (since < known.since) known.since = since;
    }
  }
  const cutoff = new Date(now.getTime() - 72 * 3_600_000).toISOString();
  return [...byId.values()].filter(thread => thread.lastAt >= cutoff).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, limit);
}

// ---- checks: every number and name the model writes must stand in the stories it cites

const NUMBER = /\d+(?:[.,]\d+)*/g;
const numberValue = (token: string) => Number(token.replace(/,(?=\d{3}\b)/g, ""));
/** Numbers in a text as values (1,250 and 1250 are one number; 6.0 and 6 too). */
export function numbersIn(text: string): number[] { return (text.match(NUMBER) ?? []).map(numberValue).filter(Number.isFinite); }

const ALWAYS_OK = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "us", "u.s", "ceo", "cfo", "eps", "sec", "the", "a", "an"]);
const plain = (text: string) => text.normalize("NFKD").replace(/[‘’]/g, "'").replace(/'s\b/gi, "");
const words = (text: string) => plain(text).toLowerCase().match(/[a-z0-9][a-z0-9.&'-]*[a-z0-9]|[a-z0-9]/g) ?? [];

/** Capitalised words, the first word of a sentence included (a sentence may start with a name): the names a text may
 * state; ordinary words among them pass the check. */
export function namesIn(text: string): string[] {
  return (plain(text).match(/[A-Za-z][A-Za-z0-9.&'-]*[A-Za-z0-9]|[A-Za-z]/g) ?? []).filter(token => /^[A-Z]/.test(token)).map(token => token.replace(/[.'-]+$/, ""));
}

/** Ordinary words: those the day's news writes in lower case at least `min` times ("outlook", "analyst"). A
 * capitalised ordinary word in a title is not taken for a name; names ("Intel", "Trump") are hardly ever lower case. */
export function ordinaryWords(texts: Iterable<string>, min = 3): Set<string> {
  const counts = new Map<string, number>();
  for (const text of texts) for (const token of plain(text).match(/(?<![A-Za-z0-9])[a-z][a-z'-]*[a-z]/g) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count >= min).map(([token]) => token));
}

/** Abbreviations a source may use for a name the model spells out. */
const SPELLED_OUT: Record<string, string[]> = { eu: ["european", "union"], uk: ["united", "kingdom"], us: ["united", "states"], "u.s": ["united", "states"], fda: ["food", "drug", "administration"], ftc: ["federal", "trade", "commission"], doj: ["department", "justice"], fed: ["federal", "reserve"] };
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

export interface CheckResult { ok: boolean; numbers: number[]; names: string[] }
/** The numbers and names of `text` that its sources do not state (empty lists = the text passes). */
export function checkAgainst(text: string, sources: string[], companyNames: string[] = [], ordinary: Set<string> = new Set()): CheckResult {
  const sourceText = sources.join(" \n ");
  const known = new Set(numbersIn(sourceText));
  const vocabulary = new Set([...words(sourceText), ...companyNames.flatMap(words)]);
  for (const [short, long] of Object.entries(SPELLED_OUT)) if (vocabulary.has(short)) for (const word of long) vocabulary.add(word);
  NUMBER_WORDS.forEach((word, value) => { if (known.has(value)) vocabulary.add(word); });
  const numbers = numbersIn(text).filter(value => !known.has(value));
  // a word is known in its singular or plural form ("Patent" against "patents")
  const knows = (part: string) => [part, `${part}s`, part.replace(/s$/, ""), `${part}es`, part.replace(/es$/, "")].some(form => vocabulary.has(form) || ordinary.has(form)) || ALWAYS_OK.has(part);
  const names = namesIn(text).filter(name => { const parts = words(name); return parts.length > 0 && !parts.every(knows); });
  return { ok: numbers.length === 0 && names.length === 0, numbers, names };
}
