/**
 * The local model reads the stored news items (owner's go of 2026-11-25). Research input; nothing reaches production.
 *
 *   npx tsx worker/news-extract.mts [--minutes 3] [--days 2] [--limit N] [--dry-run]
 *
 * Reads items/<UTC date>.jsonl of the last --days days (today included), skips copies of a story already stored, and
 * asks gemma4:12b for subject, other companies, event type, direction, novelty and a one-line fact, newest items first,
 * until the time budget ends (the scheduler has one lane; a run never holds it longer than the budget plus one item).
 * Every answer is appended at once to extract/<the item's first-seen UTC date>.jsonl, so an interrupted run loses at
 * most the item it was reading; a damaged last line is ignored and that item is asked again.
 * Each row carries the model, its digest, the prompt version and our extraction time. For research the item's
 * availability stays its first-seen time: the answer is a deterministic reading of what was then on hand.
 * Names are resolved to SEC identities with news/lookup/company-index.json (worker/news-company-index.mts).
 */
import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { CompanyIndex } from "./lib/news-companies";
import { newsLanguage } from "./lib/news-language";
import { EXTRACT_MODEL, EXTRACT_SCHEMA, EXTRACT_SYSTEM, itemText, parseAnswer, pickItems, PROMPT_VERSION, resolveName, userMessage, type NewsItemRow } from "./lib/news-extract";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/news");
const minutes = Number(arg("--minutes") ?? 3), days = Number(arg("--days") ?? 2), limit = Number(arg("--limit") ?? 100_000), dryRun = process.argv.includes("--dry-run");
if (!(minutes > 0 && minutes <= 60)) throw new Error("--minutes must be above 0 and at most 60");
if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error("--days must be 1 to 400");
for (const dir of ["items", "lookup"]) if (!existsSync(path.join(root, dir))) throw new Error(`The news archive is not complete at ${root} (no ${dir}); nothing was read or written`);
if (!/^d:/i.test(realpathSync(root)) && !arg("--root")) throw new Error("The news archive must resolve to D:");
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

const readLines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const parseLine = <T>(line: string): T | null => { try { return JSON.parse(line) as T; } catch { return null; } };   // a line cut by an interruption
const dayOf = (iso: string) => iso.slice(0, 10);
const today = new Date();
const dates = Array.from({ length: days }, (_, i) => new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));

const items: NewsItemRow[] = [];
const done = new Set<string>(), attempts = new Map<string, number>();
for (const date of dates) {
  for (const line of readLines(path.join(root, "items", `${date}.jsonl`))) { const row = parseLine<NewsItemRow>(line); if (row) items.push(row); }
  for (const line of readLines(path.join(root, "extract", `${date}.jsonl`))) {
    const row = parseLine<{ id: string; valid: boolean }>(line);
    if (!row?.id) continue;
    const tries = (attempts.get(row.id) ?? 0) + 1;
    attempts.set(row.id, tries);
    // a valid answer is final; an item without one after two tries is left (its rows stay as the record)
    if (row.valid || tries >= 2) done.add(row.id);
  }
}
// English only (owner, 2026-11-25): items stored before the collector dropped other languages are not read
const todo = pickItems(items.filter(row => newsLanguage(row).english), done, limit);
console.log(JSON.stringify({ days: dates, items: items.length, stories: items.filter(row => !row.copyOfEarlierStory).length, alreadyRead: done.size, toRead: todo.length, model: EXTRACT_MODEL, promptVersion: PROMPT_VERSION, minutes }));
if (dryRun || !todo.length) process.exit(0);

const tags = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() as Promise<{ models: { name: string; digest: string }[] }> : null).catch(() => null);
if (!tags) throw new Error("Local Ollama is unavailable on port 11434; nothing was read");
const digest = tags.models.find(model => model.name === EXTRACT_MODEL)?.digest;
if (!digest) throw new Error(`${EXTRACT_MODEL} is not installed in Ollama; nothing was read`);
// the runtime can change answers too (an update arrived on 2026-11-25), so its version is kept with the digest
const ollamaVersion = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(5000) }).then(response => response.json() as Promise<{ version: string }>).then(body => body.version).catch(() => null);
const indexFile = path.join(root, "lookup", "company-index.json");
if (!existsSync(indexFile)) throw new Error(`No company index at ${indexFile}; run worker/news-company-index.mts first`);
const indexDoc = JSON.parse(readFileSync(indexFile, "utf8")) as { builtAt: string; entries: ConstructorParameters<typeof CompanyIndex>[0] };
const index = new CompanyIndex(indexDoc.entries);

async function ask(item: NewsItemRow) {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model: EXTRACT_MODEL, stream: false, format: EXTRACT_SCHEMA, think: false, keep_alive: "15m",
      options: { num_ctx: 32768, temperature: 0, seed: 7 },
      messages: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: userMessage(item) }] }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return await response.json() as { message: { content: string }; eval_count?: number; prompt_eval_count?: number };
}

mkdirSync(path.join(root, "extract"), { recursive: true });
const deadline = Date.now() + minutes * 60_000;
let read = 0, invalid = 0, failed = 0, resolvedSubjects = 0, streak = 0;
for (const item of todo) {
  if (Date.now() >= deadline) break;
  const started = Date.now();
  let row: Record<string, unknown>;
  try {
    const answer = await ask(item);
    const label = parseAnswer(answer.message.content);
    const text = `${item.title} ${itemText(item)}`;
    const subject = label ? resolveName(index, label.subject, text) : null;
    if (subject) resolvedSubjects++;
    if (!label) invalid++;
    row = { id: item.id, storyId: item.storyId, feed: item.feed, firstSeenAt: item.firstSeenAt, extractedAt: new Date().toISOString(), model: EXTRACT_MODEL, modelDigest: digest, ollamaVersion,
      promptVersion: PROMPT_VERSION, companyIndexBuiltAt: indexDoc.builtAt, valid: Boolean(label), label: label ?? { raw: answer.message.content.slice(0, 500) },
      subject, mentioned: label ? label.mentioned.map(name => ({ name, resolved: resolveName(index, name, text) })) : [],
      seconds: Math.round(Date.now() - started) / 1000, evalTokens: answer.eval_count ?? null, promptTokens: answer.prompt_eval_count ?? null };
  } catch (error) {
    failed++;
    row = { id: item.id, storyId: item.storyId, feed: item.feed, firstSeenAt: item.firstSeenAt, extractedAt: new Date().toISOString(), model: EXTRACT_MODEL, modelDigest: digest, ollamaVersion,
      promptVersion: PROMPT_VERSION, valid: false, error: String((error as Error).message ?? error).slice(0, 300), seconds: Math.round(Date.now() - started) / 1000 };
  }
  appendFileSync(path.join(root, "extract", `${dayOf(item.firstSeenAt)}.jsonl`), JSON.stringify(row) + "\n");
  read++;
  streak = row.error ? streak + 1 : 0;
  if (streak >= 3) throw new Error(`Three model calls in a row failed (Ollama down or the model unloadable): ${row.error}`);
}
const summary = { read, invalid, failed, resolvedSubjects, left: todo.length - read, seconds: Math.round((Date.now() - (deadline - minutes * 60_000)) / 1000) };
console.log(JSON.stringify(summary));
// an invalid answer or a failed call is stored and asked once more in a later run; many of them fail the job
if (read >= 20 && (invalid + failed) / read > 0.2) throw new Error(`Too many unusable answers: ${invalid} invalid and ${failed} failed of ${read}`);
