/** Official OFAC Recent Actions collector. The retired RSS feed is not used. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prepareMacroRoot, writeTextAtomic } from "./lib/macro-io";
import { mergePoliticalEvents, parseOfacRecentActions, type PoliticalEvent } from "./lib/political-events";
import { sha256Text } from "./lib/fred";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const pages = Number(arg("--pages") ?? 1);
if (!Number.isInteger(pages) || pages < 1 || pages > 20) throw new Error("--pages must be between 1 and 20");
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const root = prepareMacroRoot(outRoot);
const normalizedPath = path.join(root, "normalized", "ofac-events.json");
const previous: PoliticalEvent[] = existsSync(normalizedPath) ? JSON.parse(readFileSync(normalizedPath, "utf8")) as PoliticalEvent[] : [];
const prog = startProgress("macro-events", `OFAC Recent Actions · ${pages} page(s) · local only`);
const current: PoliticalEvent[] = [];
const artifacts: { page: number; file: string; sha256: string; events: number }[] = [];
for (let page = 0; page < pages; page++) {
  const url = page === 0 ? "https://ofac.treasury.gov/recent-actions" : `https://ofac.treasury.gov/recent-actions?page=${page}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "AlphaEngineMacro/1.0" } });
  const html = await response.text();
  if (!response.ok) throw new Error(`OFAC HTTP ${response.status} on page ${page}: ${html.slice(0, 200)}`);
  const capturedAt = new Date().toISOString();
  const events = parseOfacRecentActions(html, capturedAt);
  if (!events.length) throw new Error(`OFAC page ${page} yielded no events; inspect the changed HTML before trusting coverage.`);
  const file = path.join(root, "raw", "ofac", `recent-actions-page-${page}.html`);
  writeTextAtomic(file, html);
  artifacts.push({ page, file, sha256: sha256Text(html), events: events.length });
  current.push(...events);
  prog.item(page + 1, pages, `OFAC page ${page} · ${events.length} events`);
}
const merged = mergePoliticalEvents(previous, current);
writeJsonAtomic(normalizedPath, merged, false);
const manifestPath = path.join(root, "manifest-events.json");
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "OFAC Recent Actions HTML",
  availability: "Publication day only; no intraday timestamp is invented.",
  coverage: "Incremental forward history. More pages may be requested explicitly; this is not a complete OFAC archive.",
  pages: artifacts,
  events: merged.length,
  newEvents: merged.filter((event) => !previous.some((old) => old.eventId === event.eventId)).length,
  normalizedFile: normalizedPath,
}, true);
prog.done(`events ${merged.length} · new ${merged.length - previous.length} · manifest ${manifestPath}`);
