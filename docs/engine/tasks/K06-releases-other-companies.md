# K06 — Release calendar and release documents for the other S&P 500 companies

Prep task for Kimi Code. Context: [`../DESIGN.md`](../DESIGN.md) sections 1.3 and 2, and
[`K01-event-calendar.md`](K01-event-calendar.md), whose procedure this task repeats on more companies.

**Status: approved by the owner by name on 2026-11-11** ("go ahead with work, put kimi to work!",
in answer to the line naming this file). It runs after K03 is delivered: one task at a time.

## Goal

The engine's one confirmed effect (the reaction to an earnings release) needs only prices and the
exact time of each release. Prices for about 500 companies are already loaded (K02). This task
gives the engine the same timeline K01 produced for the research-50, for every other company that
has both filed figures and a price series, and puts each earnings release on disk so that the
guidance pass can read it.

Two uses, in this order of importance:

1. run engine version 1 unchanged on companies it has never seen (about ten times the decisions);
2. feed the releases to the local model's guidance pass after the research-50 are done.

## LLM use

None. Ordinary code only: SEC metadata requests, downloads, string matching, date arithmetic. Do
not send any document to a model, cloud or local. Do not read documents into the agent session,
except a handful of small samples needed as unit-test fixtures.

## Companies

Every CIK that has rows in local `facts` and a `prices` series with `source = 'stooq'`, and is not
in `worker/research-universe-50.json`. Expected: about 450. Write the list once to
`D:\research\alpha-engine\engine\events\universe-rest.json` (`cik`, `ticker`, `name`) and report
its size and any company that has figures but no price series (or the reverse).

## Steps

1. **Filing metadata.** For each company, every 8-K, 10-Q and 10-K (and /A) since 2005-01-01 from
   the SEC submissions API including its older pages: accession, form, filing date, report date,
   acceptance time, items, primary document. Same access rules as K01: declared User-Agent, at most
   8 requests per second, bounded retries, resumable per company.
2. **Calendar.** Build `filings-rest.jsonl` and `quarters-rest.jsonl` with exactly the fields and
   rules of the delivered `filings-50.jsonl` and `quarters-50.jsonl`, including the four timeline
   corrections made after the first K01 delivery. Parameterize `scripts/build-event-calendar.mts`
   by universe file and output suffix; the research-50 outputs must stay byte-identical.
3. **Release documents.** For every filing that the calendar marks as an earnings release, download
   its exhibits into `worker/cache/edgar/<cik>/` with the existing fetcher and naming
   (`<accession>.ex-<name>.htm`, `manifest.json`). Earnings releases only: no 10-Q, 10-K or other
   8-K bodies in this task.

## Order of work, so that partial results are usable

Process companies in descending order of their number of `facts` rows (largest histories first),
and finish steps 1 to 3 for one company before starting the next. After every company, rewrite
`quarters-rest.jsonl` atomically and append the company to `progress-rest.json`. A reader may use
the files at any moment; companies not yet listed there are simply absent.

Pilot before the long run: the first 20 companies. Report for them the number of quarters, the
share of quarters with an earnings release paired, the K01 acceptance checks, the bytes downloaded
and the seconds taken, and the projected totals for all companies. Continue to the full list only
if every K01 check passes on the pilot and the projected download fits on D: with at least 100 GB
left free; otherwise stop and report.

## Deliverables

Under `D:\research\alpha-engine\engine\events\` (outside Git): `universe-rest.json`,
`filings-rest.jsonl`, `quarters-rest.jsonl`, `progress-rest.json`, `manifest-rest.json` (counts,
hashes, code commit, start and end time). In Git: the parameterized builder with its tests, and a
summary `research/engine/event-calendar-rest.summary.json` (counts per company, check results).

## Acceptance checks

1. Every K01 acceptance check, per company, with the K01 thresholds.
2. Research-50 outputs unchanged (same SHA-256 as before this task).
3. For 30 randomly chosen quarters (seeded), the acceptance time of the earnings release equals
   the time on the filing's SEC index page.
4. Every earnings release in `quarters-rest.jsonl` either has at least one exhibit file on disk or
   is listed with a reason in the summary.
5. The usual gates: `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`.

## Out of scope and stop conditions

- Everything this task collects goes to D: (documents through the `worker\cache` junction, the
  calendar files under `D:\research\alpha-engine\engine\events\`). C: is the small system disk
  (owner's reminder of 2026-11-11): nothing new there except source code and the small summary file.
- No database writes: the existing fetcher keeps its filing list in per-company `manifest.json`
  files, and the calendar is built from those and from the SEC metadata. No schema change; nothing
  to production; no scheduler or registry change.
- No model calls. No GDELT. Raw documents stay on D: behind the existing junction.
- Stop and report instead of improvising if the SEC throttles for more than 15 minutes, if a
  company's submissions pages are inconsistent with K01's assumptions, or if disk space falls
  under the limit above.
