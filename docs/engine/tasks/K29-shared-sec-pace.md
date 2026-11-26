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
