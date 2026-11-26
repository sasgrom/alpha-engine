# K29 — One SEC request budget for the whole machine

Task for Kimi Code, from Kimi's own proposal of 2026-11-26. **Owner's go of 2026-11-26** (owner asked Claude to "review
and create instructions for him"). Written by Claude the same day. Kimi's credits end 2026-11-30 16:00.

## Why

SEC allows about 10 requests a second per IP address. `secGet` (`worker/lib/edgar.ts`) paces only its own process, at 7 a
second by default (`SEC_RPS`, cap 8). Two collectors at once (K27 part B beside part C, or a long run beside the nightly
`edgar-fetch-daily`, insiders and filings jobs) can send 14 a second and get the IP blocked for about 10 minutes, which
breaks every SEC job on the machine.

## Build (code and tests now, wiring later)

New module `worker/lib/sec-shared-pace.ts`, no change to `edgar.ts` in this step:
1. **Machine-wide slots.** A small state file on C: (`worker/.runs/sec-pace/state.json`) holds the next free request
   time. A process takes a slot under an exclusive lock (atomic `mkdir` or `open(…, "wx")`), moves the next free time on
   by `1000 / budget` ms, releases the lock, then waits for its slot. Budget `SEC_MACHINE_RPS`, default 8, cap 9. The
   process's own `SEC_RPS` stays an upper bound for that process.
2. **Stale lock.** A lock older than 2 s is taken over (a process died holding it). The lock is never held during a
   network request.
3. **Fallback.** If the lock or state cannot be read or written within 2 s (disk full, permissions), the process falls
   back to its own pacing at 2 requests a second and logs that once. Never unpaced.
4. **Shared cool-down.** A 429, or a 403 whose body says the request rate was exceeded, writes `coolDownUntil` (now +
   10 min, or Retry-After if longer) into the state; every process waits until then before its next SEC request. A
   repeated 502/504 run stays the caller's business (K27's HTML-index fallback is unchanged).
5. **Telemetry.** Each process keeps counts (requests, total wait, 429, 403, 5xx, fallbacks, cool-downs) and appends one
   line a minute and one at exit to `worker/.runs/sec-pace/<UTC date>.jsonl` with the job name (`SEC_JOB` or the script
   name) and pid. No URLs with query strings, no headers.

Tests (vitest, no network): slot arithmetic with an injected clock; two and three real child processes against a local
fake HTTP server for 5 s at budget 8, asserting that no 1-second window holds more than 8 requests in total; stale-lock
takeover; fallback when the state folder is read-only; cool-down seen by a second process.

## Wiring (only after K27 part B is complete, before part C starts)

- **First, an inventory:** every place that sends requests to `sec.gov` or `data.sec.gov`, in this repository and in
  `C:/dev/alpha-engine-lab` (grep both). List each one with its client and whether it goes through `secGet`.
- **Hashes:** list every manifest or checkpoint whose code fingerprint includes `worker/lib/edgar.ts`. Kimi suggested
  separating these fingerprints (proposal 2); keep that idea out of this task. The pinned K06 release calendar is never
  rerun, so its recorded hash simply stays as it is. **If K28's flash build hash (`7f76b2c…`) or any running job's
  checkpoint depends on `edgar.ts`, stop and write to Claude before wiring.**
- Then make one edit to `edgar.ts`: `throttle()` takes its slot from the shared module. The TypeScript clients that
  bypass `secGet` are routed through it where that is a small change. The others are listed for Claude.
- Announce the wiring in Claude's mailbox before doing it. Never change `edgar.ts` while any SEC collector is running.
  Check `Get-CimInstance Win32_Process` command lines first.

## Rules

AGENTS.md in full. No change to the scheduler, job definitions or `operations-config.json`. Own paths only, plus the one
`edgar.ts` edit. Write to Claude's mailbox before a full test run or build.

## Acceptance

1. The tests above pass. Also `npm run check`, `npm test -- --run`, `npm run build` and `git diff --check`.
2. After wiring, a 10-minute live check while part C and one nightly SEC job (or a manual `edgar-fetch-daily` dry
   window) run together: the telemetry shows the combined rate at or below the budget, with 0 429s.
3. Delivery report at the end of this file: the inventory, the hash list, the telemetry summary, commits, and a handoff
   section.

## Wiring inventory — read-only, 2026-11-26

No wiring has been done while an SEC collector is active. Direct-request inventory (fixtures and source-URL-only strings
excluded):

### Main repository

- `worker/lib/edgar.ts` — central worker `secGet`; used by `edgar-fetch`, `edgar-exhibits`, `form4-fetch`, `form4-qa`,
  `news-company-index`, `news-feeds` (SEC 8-K Atom), `facts-incremental`, and the SEC paths in `13f-refresh`,
  `fetch-13f-cache`, `build-13f-top300`, `build-event-calendar`, `build-fund-first-filings`, `build-company-headquarters`,
  `build-russell1000-membership`, `build-russell1000-former-listed`, `build-release-calendar-rest`, and the gap/exposure
  probes. These inherit shared pacing when `secGet` is wired.
- `api/services/edgar.ts` — separate server-side limiter/client, not the worker `secGet`; `api/services/documents.ts`,
  `api/services/insiders.ts`, runner and presentation callers go through it. `api/lib/`/`api/kimi/` are prohibited here;
  this server client is listed for Claude rather than silently changed.
- `scripts/seed-sp500-companies.mts` — one direct `fetch` to `company_tickers_exchange.json`; a small `secGet` routing
  candidate, separate from the one-file `edgar.ts` wiring edit.

### Lab repository

- Through main `worker/lib/edgar.ts`: `src/insiders/sec-bulk.mts`, `edgar-insiders.mts`, `insider-acceptance.mts`;
  `src/research/spx/nport_fetch.mts`; `src/research/fable1/ftd_fetch.mts` and `ftd_probe.mts`;
  `src/fundamentals/edgar-filings-fetch.mts` and `fsds-fetch.mts`.
- Bypasses that client: `src/thirteenf/dates.mts` uses injected/global `fetch` with a local 210 ms limiter. It needs its
  own reviewed routing or must remain explicitly listed; it is not covered by editing main `edgar.ts`.

### Code fingerprints and live-check constraint

`scripts/build-release-calendar-rest.mts:80-90` explicitly includes `worker/lib/edgar.ts` in B/K06/K23 release-calendar
code hashes and company checkpoints. B is therefore a running job whose checkpoint depends on `edgar.ts`; wiring must be
announced again after B exits and no SEC process is active. The pinned K06 artifacts will not be rerun. K28's
`7f76b2c2…` fingerprint is defined at `scripts/build-flash-statements.mts:61-64` and does **not** include `edgar.ts`.
No other source code fingerprint containing the literal `worker/lib/edgar.ts` was found in the main worker/scripts
inventory.

The requested ten-minute concurrent live check cannot use full C: the owner cancelled full C. Claude's 10:45Z decision
substitutes two bounded SEC users: a few-company `worker/edgar-fetch.mts` using its existing options/cache beside the SEC
8-K path of `worker/news-feeds.mts --set fast` (or K28's post-pass). The check remains restart-free and is announced before
launch; acceptance is combined rate within budget and zero 429s.
