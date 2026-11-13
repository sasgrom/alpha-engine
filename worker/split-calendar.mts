/**
 * The daily split watch's calendar (owner, 2026-11-13: "yahoo should have future split calendar ... we can put it on
 * daily watch" — "yes"): the US stock splits Yahoo's split calendar lists for the next 60 days, with the companies of
 * our price series flagged. The daily bars job (schwab-daily-bars.mts) re-bases a series when Schwab re-bases its history
 * after a split; this calendar says which splits to expect.
 *
 * Polite: one session cookie and crumb, then one request per 250 rows (at most 8), two seconds apart; nothing but the
 * dates is sent, with a generic client header. Local only: D:\research\alpha-engine\prices\split-calendar\<date>.json
 * and latest.json. A failed fetch fails the job (it shows on the desk's operations banner).
 *
 * Usage: npx tsx worker/split-calendar.mts [--days 60]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isUsListing, ratioText, readSplitCalendar, splitCalendarQuery, type UpcomingSplit } from "./lib/split-calendar";
import { schwabPriceSeries } from "./lib/schwab-price-series";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 60;
const OUT = "D:/research/alpha-engine/prices/split-calendar";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "*/*" };
const today = new Date().toISOString().slice(0, 10);
const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// a session cookie (the cookie host answers 404 but sets it) and the crumb that goes with it
const start = await fetch("https://fc.yahoo.com", { headers: HEADERS, redirect: "manual" }).catch(() => null);
const cookie = (start?.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0]).join("; ");
const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...HEADERS, Cookie: cookie } });
const crumb = (await crumbResponse.text()).trim();
if (!crumbResponse.ok || !crumb || crumb.length > 40) throw new Error(`Yahoo gave no crumb (HTTP ${crumbResponse.status})`);

const all: UpcomingSplit[] = [];
let pages = 0;
for (let offset = 0; pages < 8; offset += 250) {
  const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(splitCalendarQuery(today, until, offset)),
  });
  if (!response.ok) throw new Error(`Yahoo's split calendar answered HTTP ${response.status}`);
  const page = readSplitCalendar(await response.json());
  pages++;
  all.push(...page);
  if (page.length < 250) break;
  await wait(2000);
}

const ours = new Map(schwabPriceSeries().map((series) => [series.ticker.toUpperCase(), series]));
const us = all.filter((split) => isUsListing(split.ticker));
const universe = us.filter((split) => ours.has(split.ticker) || ours.has(split.ticker.replace("-", ".")));
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Yahoo split calendar (query1.finance.yahoo.com/v1/finance/visualization, entityIdType splits)",
  from: today,
  until,
  pages,
  counts: { all: all.length, us: us.length, universe: universe.length },
  universe: universe.map((split) => ({ ...split, text: ratioText(split) })),
  us,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `${today}.json`), JSON.stringify(summary, null, 1));
writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(summary, null, 1));
for (const split of universe) console.log(`upcoming split in our universe: ${split.ticker} ${ratioText(split)} on ${split.date} (${split.company})`);
console.log(JSON.stringify({ from: today, until, pages, ...summary.counts }));
