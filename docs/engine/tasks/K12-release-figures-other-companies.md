# K12 — Release figures for the other companies (K03's reader over the K06 releases)

Task for Kimi Code. **Approved by the owner on 2026-11-16** ("prepare instructions for kimi to complete what u
think is necessary and send it to him", after Claude named K12 as needed). Run it after K23. Written by Claude on
2026-11-12 after the engine test on the K06 companies (`../DESIGN.md` section 6).

**Amendment of 2026-11-16 (Claude):**
- Scope is K06's 446 companies plus the six that K23 adds (Target, Hasbro, Parker-Hannifin, Welltower, T. Rowe Price,
  Tapestry), read from K23's addendum files: 452 in all.
- Second purpose: the pooled engine (design doc, iteration 3) showed that next-quarter information pays only when
  learned across all companies. The release-day figures, the earliest public numbers, are needed for the whole
  universe, not just the 50.
- Everything else below is unchanged.

## Why

The engine's release-reaction rule does not repeat on the other 440 companies. The next test that
was fixed before that data existed is **revenue acceleration after a fall**, together with the
other expectations readings (lab README, "Expectations against the early 8-K figures"). It needs
the figures printed in each earnings release, on the day the release comes out. K03 reads them for
the 50. This task runs the same reader over the K06 companies' releases.

## LLM use

None. The reading, naming and grading are K03's ordinary code (answer key from facts filed before
the release).

## Scope

The 446 companies of K06 (`D:\research\alpha-engine\engine\events\universe-rest.json`), earnings
releases from 2009-01-01 (`filings-rest.jsonl` with `isEarningsRelease`; pairing from
`quarters-rest.jsonl`). The exhibits K06 cached on D:, and the local MySQL `facts` (read-only,
filtered by `cik`), are the only inputs. Nothing is downloaded. If K06 did not cache an exhibit,
the release is reported as not available, never fetched.

## What to build

- `scripts/build-flash-statements.mts` takes its calendar files and output folder as options, with
  today's 50-company run unchanged as the default. The stages under `worker/lib/flash-*` are reused
  as they are; change them only for a defect you show on a fixture, with a regression test.
- Output under `D:\research\alpha-engine\engine\flash-rest\`: `statements.jsonl`, `values.jsonl`,
  `grades.jsonl`, `residual.jsonl`, `manifest.json`, as in K03.
- The engine-facing extract `flash-quarter-rest.jsonl` in the same folder, one line per release:
  - identity: `cik`, `ticker`, release `accession`, `acceptedEt`, `fiscalPeriodEnd`;
  - for the quarter, as printed: revenue, net income, diluted earnings per share and operating
    income;
  - for each of those, the year-ago value printed beside it;
  - for each value: the concept it was named by, and its grade against the later filing.
  Use the same field names as the 50-company extract that the lab's `step2d-flash.mts` reads. A
  value the reader could not name stays null; it is never filled from `facts`.
- Committed summary `research/engine/flash-statements-rest.summary.json` with the acceptance tables.
- The D: interruption protocol of AGENTS.md section 3.1 applies: per-release checkpoints, no C:
  fallback, resume after a remount check.

## Acceptance checks

Report each as numbers, overall, by year and by company.

1. **Coverage.** Releases processed, and the share with an income statement, a balance sheet and a
   cash-flow statement found. List the companies with none, and the releases whose exhibit is not
   cached.
2. **The 50 unchanged.** Running the default (50-company) configuration reproduces K03's outputs
   byte for byte apart from generation time. The golden check `scripts/check-flash-golden.mts`
   still passes 113/113.
3. **Period check.** The current-period end equals K06's `fiscalPeriodEnd` in at least 98% of
   releases with an income statement.
4. **Grade.** Of gradable current-period values, at least 98% match the later filing. List the 30
   most frequent mismatch patterns with one example each.
5. **Point in time.** The automated audit finds 0 answer-key facts filed on or after the release
   date, and 0 values not taken from the printed cell.
6. **Extract.** In `flash-quarter-rest.jsonl`: the share of releases with quarter revenue and with
   its year-ago value, by year and sector. Also the share of releases whose printed revenue equals
   the later-filed figure.
7. `npm run check`, the targeted tests, `npm test -- --run`, `npm run build`, `git diff --check`.
   No production write, no schema change, no model call, no new collector or scheduler entry.

## Run and resume

Run from `C:\dev\alpha-engine`. The full run reads only cached exhibits and local MySQL data. It does not
download documents or use a model. Each release is checkpointed under
`D:\research\alpha-engine\engine\flash-rest\releases\`; no checkpoint or output falls back to C:.

```powershell
npx tsx scripts/build-flash-statements.mts --filings D:/research/alpha-engine/engine/events/filings-rest.jsonl --filings D:/research/alpha-engine/engine/events/filings-six.jsonl --quarters D:/research/alpha-engine/engine/events/quarters-rest.jsonl --quarters D:/research/alpha-engine/engine/events/quarters-six.jsonl --universe D:/research/alpha-engine/engine/events/universe-rest.json --universe D:/research/alpha-engine/engine/events/universe-six.json --output D:/research/alpha-engine/engine/flash-rest --summary research/engine/flash-statements-rest.summary.json --extract D:/research/alpha-engine/engine/flash-rest/flash-quarter-rest.jsonl
```

After an interruption, first confirm that D: is mounted and the calendar files and `flash-rest` directory are
readable. Then rerun **the same command**, without `--force`. Valid per-release checkpoints are reused and only
missing or changed releases are processed. Do not remove the checkpoint directory or resume from a partial JSON
file. Artifact and summary writes use a temporary file followed by an atomic rename on D: (the committed summary
uses the same atomic-write helper in the repository).

Acceptance and the unchanged 50-company regression:

```powershell
npx tsx scripts/build-flash-statements.mts
npx tsx scripts/check-flash-golden.mts
npx vitest run worker/lib/flash-extract.test.ts worker/lib/flash-pipeline.test.ts worker/lib/flash-summary.test.ts worker/lib/flash-facts.test.ts worker/lib/flash-html.test.ts
npm run check
npm test -- --run
npm run build
git diff --check
```

The full-run summary must have income-period match of at least 98%, gradable-value match of at least 98%, zero
answer-key facts filed on/after release and zero values not sourced from a printed cell. Rerunning the full command
after a successful build also serves as the resume/read-back check: every valid checkpoint should be reused.

If another agent must continue K20 instead, its artifact is
`D:\research\alpha-engine\insiders\std\20261116T223552Z`. Verify the staged ID prefix before resuming:

```powershell
npx tsx C:/dev/alpha-engine-lab/src/insiders/load-insiders.mts D:/research/alpha-engine/insiders/std/20261116T223552Z i1.1.20261116 --replace --resume-partial --artifact-code 8c2a2606c8db34663a5617733157e630a959463a
npx tsx C:/dev/alpha-engine-lab/src/insiders/verify-insiders-load.mts D:/research/alpha-engine/insiders/std/20261116T223552Z i1.1.20261116
```

Do not mark i1.1 final unless the independent live check passes. Claude has accepted the artifact itself.

## Delivery

A delivery report in this file, the usual handoff note, and a mailbox message to Claude.
