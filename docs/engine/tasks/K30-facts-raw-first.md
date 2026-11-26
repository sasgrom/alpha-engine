# K30 — companyfacts: keep the raw answer first, exclude what the table cannot hold

Task for Kimi Code, from Kimi's own proposal of 2026-11-26. **Owner's go of 2026-11-26** (owner asked Claude to "review
and create instructions for him"). Written by Claude the same day. This is a small task: do it beside K27 part B, which
does not use this code.

## Why

`runFactsCollection` (`worker/lib/facts-incremental.ts`, lines 212–217) ingests a new companyfacts answer first and
writes the raw file only after the ingest succeeds. In K27 part A, GLOB's ingest rejected one concept longer than 200
characters. So the whole company failed, and the SEC answer we had already downloaded was thrown away.

## Change

1. **Raw first.** Write the validated answer atomically (temp file, then rename; CIK checked, at least one row) to the
   raw cache before the ingest. The manifest records the ingest outcome separately. A failed ingest leaves
   `status: "failed"` with the new raw on disk and the previous `rawSha256`. The existing `raw_hash_changed` rule then
   re-ingests it on the next run without downloading it again. Check that the existing test "preserves previous good raw
   and success timestamps after a failed new download" still holds: a failed *download* never replaces good raw.
2. **Explicit exclusions, no truncation.** Rows the `facts` table cannot hold (concept longer than the column, currently
   200 characters; read the limit from the schema, do not hard-code a guess) are left out of the ingest, never cut short.
   Each company's manifest gets `excluded: [{ reason, count, examples: [{ concept prefix of 80 chars, length }] }]`, and
   the run summary gets a total. The raw file keeps them.
3. **Rerun GLOB only** with the existing collector and its local ingest. Report rows ingested, rows excluded with their
   concepts, and its periods. OZK (an FDIC filer) and CIK 200411 (SEC 404) stay listed failures; do not hunt for other
   sources.

No schema change and no change to `api/lib/`. The column stays as it is; widening it would be a schema change for the
owner.

## Tests

- A raw file is written before the ingest, and a failed ingest leaves the new raw plus `status: "failed"`.
- The next run re-ingests from the cache without a download.
- An overlong concept is excluded and counted, the other rows are ingested, and the raw file is complete.
- The existing `facts-incremental` tests still pass.

## Rules and acceptance

AGENTS.md in full; own paths only (`worker/lib/facts-incremental.ts`, its test, `worker/facts-fetch.mts`). The nightly
`facts-fetch-daily` job uses this code: commit only after `npm run check`, the facts tests, `npm test -- --run`,
`npm run build` and `git diff --check` pass. Write to Claude's mailbox before the full test run. Make sure no
facts-fetch process is running when you switch the code. Deliver a report at the end of this file, a handoff section and
a mailbox message.
