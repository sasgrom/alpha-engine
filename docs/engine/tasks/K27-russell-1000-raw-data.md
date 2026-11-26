# K27 — Raw data for the new Russell 1000 companies

Task for Kimi Code. **Owner's go of 2026-11-25** ("go with task pipeline for kimi"). Written by Claude the same day.
Runs after K26 is delivered. It uses K26's universe files `worker/edgar-universe-r1000-new.json` (active members not in
our registry) and `worker/edgar-universe-r1000-former.json` (former members). Kimi's credits end 2026-11-30 16:00:
finish each part for all companies before starting the next part, and report after each part.

## Goal

The same raw inputs our 502 companies have, collected for the new companies with the **existing collectors** at their
usual pace. Raw data only: Claude builds the standards (prices, fundamentals, insiders, release calendar, the engine's
dataset) from it afterwards, with their gates. No standard build, no research-table load and no model call in this task.

## Parts, in this order

**A. SEC companyfacts**, for active and former members:
`npx tsx worker/facts-fetch.mts --universe edgar-universe-r1000-new.json`, then the same with `-former`. This is the
existing incremental collector with its local ingest into `alpha_engine.facts`, the path every company's figures take;
it adds rows only for the new CIKs. Report per company: facts rows, first and last period, and the failures after its
own retry.

**B. Release calendar and earnings-release exhibits** (K06's procedure, `K06-releases-other-companies.md`, steps 1 to 3
with its point-in-time audit), for active and former members. Use the K26 universe instead of K06's
"has a stooq price series" rule; everything else is unchanged. Write an addendum with the suffix `r1000`:
`filings-r1000.jsonl`, `quarters-r1000.jsonl`, `universe-r1000.json` and `progress-r1000.json` in
`D:/research/alpha-engine/engine/events/`, with the exhibits in K06's cache layout (`worker/cache/edgar/<cik>/`, a
junction to D:). K06's and K23's files stay byte-identical. **Pilot the first 20 companies first** and report quarters
paired, releases found, exhibit bytes, and the projected total size. **Stop and write to Claude if the projection is
over 150 GB.**

**C. 10-Q and 10-K primary documents**, for active members only:
`npx tsx worker/edgar-fetch.mts --universe edgar-universe-r1000-new.json` (the existing fetcher; 8-K bodies are not
needed beyond part B). Use the same pilot-and-projection rule as B.

**D. Schwab daily price history**, for active members:
- `worker/schwab-history-backfill.mts` has `--only` but no universe option. Add `--universe <file>` (with a test), and
  write to a new folder `D:/research/alpha-engine/schwab/history-r1000/`. Use `--years 20`, or the longest the API
  gives, at the collector's own pace.
- **Raw files only:** do not load them into `alpha_engine.prices` (the app would then treat these companies as its
  own). Report per ticker: candles, first and last date, and empty answers.
- Schwab is market data only (AGENTS.md section 3): no account, order or position endpoint. Never print the token.

**E. Corporate actions and older prices:**
- Run the lab's `C:/dev/alpha-engine-lab/src/prices/yahoo-actions-fetch.py` for the new tickers (owner's permission
  for Yahoo: split and dividend events only, one request at a time, tickers and dates only). Write to a new dated
  folder; do not touch the existing pulls.
- Stooq: report which new tickers the existing Stooq archive on D: already holds. Download nothing new from Stooq in
  this task.

**F. Former members' gaps:** a table of every former member showing what parts A to E found (facts, releases, prices
from any source) and what is missing. Do not hunt for other sources.

## Rules

- AGENTS.md in full. Existing collectors and their pace only. No writes to `alpha_research` and no schema change. The
  only database write is part A's existing local ingest of `facts`.
- No change to the app's company registry, the scheduler, or the nightly jobs' universes. Daily collection for the new
  companies is a later decision of the owner's.
- D: protocol of section 3.1: every long run resumable from per-company checkpoints; on a D: failure, stop and keep
  the partial state; nothing on C: except code and docs.
- **Own paths only.** The only file of Claude's area to change is `worker/schwab-history-backfill.mts` (part D,
  additive). Write to Claude's mailbox before any full test run, build, or web or scheduler restart. A part interrupted
  by the credit end must be left resumable, with the resume command written into this file.

## Acceptance

1. Per part: counts per company and in total, failures with their reason, bytes on D:, and the resume command.
2. B: K06's point-in-time audit with 0 violations on the addendum; K06's and K23's files are byte-identical (hashes
   before and after).
3. D: the new option is tested; existing backfill files are unchanged.
4. The usual gates for code: `npm run check`, the targeted tests, `npm test -- --run`, `npm run build`,
   `git diff --check`.

## Delivery

A delivery report at the end of this file (per part), a handoff section, and a mailbox message to Claude after each
part. Commit and push code and docs. Then start K28 if the owner approved it.


## Owner amendment — still-listed former members, 2026-11-25

Owner's word, relayed by Claude: "as far as companies that were in russel 1000 and at some point had departed, unless
they were delisted we should have them updated to current time".

- Former members are divided by the current SEC `company_tickers_exchange.json`, fetched through `secGet` and cached on
  D:. Preferred/instrument-only rows are not common-stock collection targets; multiple current common classes are each
  retained.
- Current result: **192 still-listed companies / 219 common-share listings** and **200 without a current common-stock
  listing**. Claude's earlier read of the source was 193; the one-company difference follows the common-stock filter and
  is not hidden.
- `worker/edgar-universe-r1000-former-listed.json` is generated by
  `npx tsx scripts/build-russell1000-former-listed.mts`; its test covers multiple common classes and excluded preferred
  instruments. The source response, SHA-256, universe hash and gone reasons are recorded in
  `D:/research/alpha-engine/index-membership/russell1000/k27-former-listed-evidence.json`.
- Parts A and B already include every former member and are unchanged. Parts C, D and E must additionally include every
  still-listed former member through the present. The other 200 receive data through their last available trading day
  only. Part F records Form 25/15 or merger evidence when SEC supplies it, without another source hunt.
- This creates no scheduler, nightly-universe, app-registry or production change. Any later daily inclusion of these
  companies is a separate owner decision.

Current source response: 10,400 SEC rows, 521,932 bytes, SHA-256
`a4549a73d027584e90490c5b8ff207de3e6a607768c7de416144ef52e6474c84` at
`D:/research/alpha-engine/index-membership/russell1000/k27-company_tickers_exchange-2026-11-26.json`.


## Interim delivery: A, C, D and E; B running — Kimi, 2026-11-26

### A — SEC companyfacts (complete after K30's GLOB recovery)

- **907/909 companies succeeded**, 16,327,808 raw fact rows, 2,461,846,530 raw bytes. Active 516/517, former 391/392.
  GLOB contributes 4,535 raw / 4,534 ingested and one explicitly excluded 212-character concept; all other ingested rows
  total 16,327,807. OZK (CIK 1569650) and CIK 200411 remain SEC 404 after the existing retry; no alternative source.
- Per-company periods/counts/hashes: `D:/research/alpha-engine/index-membership/russell1000/k27-a-companyfacts.json`;
  GLOB's recovered manifest is `worker/cache/companyfacts/manifest/1557860.json` and K30's task report. Only the
  authorized local `factsSnapshot` ingest wrote the app DB.
- Resume: `SEC_RPS=1 npx tsx worker/facts-fetch.mts --universe edgar-universe-r1000-new.json`, then the same with
  `edgar-universe-r1000-former.json`.

### B — release calendar/exhibits (pilot accepted; full collection not complete)

- Pilot 20/20: 7,761 filings, 1,758 quarters, 1,857 releases, 1,183,264,040 bytes, 30/30 seeded index-time matches;
  K06's and K23's five artifacts each remained byte-identical. Repeated SEC index 502/504 responses have a tested
  official HTML-index fallback.
- Full collection is active from atomic company checkpoints. At 07:33Z it was 327/909, latest LBTYA; this is not a
  completion claim. Owner's 05:15 skip rule is implemented in source commit c37815c: two retries, partial checkpoints,
  `r1000-todo.jsonl`, and one two-attempt post-pass. Completed counts/failures will be reported only from the final
  manifest. Resume: `SEC_RPS=1 npx tsx scripts/build-release-calendar-rest.mts --universe
  edgar-universe-r1000-new.json,edgar-universe-r1000-former.json --addendum r1000 --limit 909`.

### C — 10-K/10-Q primary documents (20-company pilot kept; full part skipped by owner)

- Added tested `--limit` and `--forms 10-K,10-Q` controls; amendments are included and no 8-K bodies are downloaded.
  Pilot: 20 companies, 2,675 primary documents, 4,507,522,421 bytes, 39 retained missing/failed rows. Evidence:
  `D:/research/alpha-engine/index-membership/russell1000/k27-c-primary-pilot.json`.
- Projected full C was 159.79 GB and B+C 194.20 GiB. On 2026-11-26 the owner accepted Claude's recommendation to skip
  full C. **Do not resume it.** Part F lists these documents as not collected. The pilot and resume command in its
  evidence remain unchanged.

### D — Schwab 20-year history (complete)

- **733/736 ticker histories**, 2,409,370 candles, 233,802,166 bytes, all raw and outside the app price tables. Empty:
  CIK1437107, CIK1604778 and FGRS. Per-ticker dates/counts/hashes:
  `D:/research/alpha-engine/index-membership/russell1000/k27-d-schwab-history.json`; raw is
  `D:/research/alpha-engine/schwab/history-r1000/`.
- Resume: `npx tsx worker/schwab-history-backfill.mts --universe
  edgar-universe-r1000-new.json,edgar-universe-r1000-former-listed.json --years 20 --out
  D:/research/alpha-engine/schwab/history-r1000 --min-interval-ms 1000`.

### E — Yahoo actions and Stooq coverage (complete)

- Yahoo: 736 tickers, **732 ok / four not found / zero failed**; BMNP has `dividendsAtLimit=true`. New immutable folder:
  `D:/research/alpha-engine/prices/yahoo/r1000-actions-2026-11-26T020001764Z`.
- Stooq no-download coverage: **722/736 present, 14 missing**. Evidence:
  `D:/research/alpha-engine/index-membership/russell1000/k27-e-stooq-coverage.json`. Existing Stooq archives were read;
  nothing was downloaded from Stooq.
- Code gates for these completed parts and B's current source: TypeScript, targeted tests, full 300 files / 1,783 tests,
  production build and `git diff --check` pass. No scheduler, registry, schema, research DB or production change.
