# K11 — Fund-flow hall data: the famous investors' filers, and the flow builds on the scheduler

Task for Kimi Code, written by Claude on 2026-11-12. **Not approved yet**: it starts only when the owner names it
(after K10, unless the owner orders otherwise).

## LLM use

None.

## Why

The hall's "People" audience shows the best-known faces behind the tracked 13F filers (Buffett, Griffin, Dalio,
Cathie Wood, Ackman and 18 more, `src/desk/flows/hall/famous.ts`). Six well-known investors are missing because
their firms' 13F reports are not in the local cache: Michael Burry, Stanley Druckenmiller, David Tepper, Carl Icahn,
David Einhorn and Li Lu. They stand by the entrance as "not in the books yet". The flow files are also rebuilt only
by hand today.

## What to do

1. **Add the six filers to the 13F universe** read by `scripts/13f-refresh.mts` (`funds-13f.json`, the file the
   scheduler's 13F job uses). Verify each CIK and entity name on EDGAR before adding; candidates from Claude's
   notes, to be checked, not trusted: Scion Asset Management 1649339 (Burry; deregistered in 2025, so history only),
   Duquesne Family Office 1536411 (Druckenmiller), Appaloosa 1656456 (Tepper), Icahn Carl C / Icahn Capital
   921669, Greenlight Capital 1079114 and DME Capital Management 1489933 (Einhorn; take the one that files the 13F
   now, and say which), Himalaya Capital Management 1709323 (Li Lu).
2. **Fetch their 13F-HR filings from Q3 2020** with the existing refresh (fair-access client, cache on D: behind
   the `worker\cache` junction; never delete from it), rebuild the books (`npx tsx scripts/build-fund-books.mts`)
   and the flows (`npx tsx scripts/build-fund-flows.mts`).
3. **Scheduler entries** (contracts/operations.ts registry, local outputs only, no production push, no automatic
   report push): `fund-books` then `fund-flows` after `13f-refresh`; `company-headquarters`
   (`scripts/build-company-headquarters.mts`) and `fund-first-filings` (`scripts/build-fund-first-filings.mts`)
   weekly, before `fund-flows`. Use the existing dependency and lock patterns; no second scheduler.

## Acceptance checks

- Each added filer: CIK, EDGAR name and the quarters found are listed in the delivery report; a filer without 13F
  reports in the period is reported as such, not invented.
- `worker/.runs/desk-flows/overview.json`: the added filers appear in `funds` with their quarters; for every other
  fund, `tracked` and each quarter's `fundFlows` entry are unchanged against the build before K11 (same books
  code), or every difference is explained in the report.
- Scheduler: `npx tsx worker/operations-scheduler.mts --once --dry-run` (or the existing equivalent) shows the four
  jobs in order with their dependencies; one scheduler process before and after.
- Gates: `npm run check`, the full suite, `npm run build`, `git diff --check`. Handoff section with counts and
  hashes of the rebuilt overview.

## Out of scope

The hall itself (Claude adds the new faces to `famous.ts` once the filers are in the books), politicians' trades
(the owner's legal decision), any production write.
