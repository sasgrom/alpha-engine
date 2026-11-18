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

## Delivery report — 2026-11-17T22:00Z (Kimi)

The full cached run and a no-force resume completed. The machine-readable summary is
`research/engine/flash-statements-rest.summary.json`; it contains the complete overall, year, company, period-exception,
30-mismatch-pattern, extract-year and extract-sector tables required by the acceptance checks. The report below is the
summary, not a claim of independent review or predictive value.

### Run, coverage and universe

- Builder base commit `c58c5e0ca8085f7805421561c2ec0d17b7140709`; exact source hash
  `6571aaaa97dffdf216e92430cd2397ead9f027eee96f0ffbace238f605dd07a3`.
- Full-run generation `2026-11-17T21:17:39.240Z`; resume generation `2026-11-17T21:53:04.738Z`.
- Universe: **452 companies**, **450 with releases**; ENLT and VYLR are explicitly retained without releases.
- Releases: **31,258 expected / 31,258 processed / 0 errors**. Exhibits: **63,421**, with **11 duplicate exhibits** and
  **1,991 releases whose exhibit is not cached**. Nothing was downloaded.
- Income statements: **26,605/31,258 (85.1142%)**; balance sheets **23,679 (75.7534%)**; cash-flow statements
  **16,338 (52.2682%)**. Full year/company coverage and the companies without statements are in the committed summary.
- Resume reused **31,258/31,258 checkpoints**, processed **0** releases again and preserved every JSONL artifact hash.
  The command-wrapper timeout detached rather than terminated the resume; its existing Node process was monitored to
  completion and no duplicate builder was started.

### Acceptance results

1. **Coverage:** reported above and in full by year and company in the summary. The 1,991 uncached-exhibit releases are
   explicit exclusions, not fetched or silently counted as parsed.
2. **Default 50:** **3,609/3,609 checkpoints reused**, 0 reprocessed and 0 errors; golden **113/113 passed**. Period
   match is **2,949/2,957 (99.7295%)**, grade match **111,410/113,279 (98.3501%)**, with zero PIT violations. Under
   Claude's 2026-11-17 amendment, byte identity with immutable K03 is not claimed; the changed 50 now requires the
   release-by-release correction diff and independent no-regression review.
3. **Period:** **25,391/25,574 = 99.2844%**, passing the 98% minimum. There are **1,031 unpaired** income releases;
   period exceptions and all year/company rows are in the summary.
4. **Grade:** **868,886/885,983 = 98.0703%**, passing the 98% minimum; **17,097 mismatches** and **202,175
   not-gradable values** remain explicit. The 30 most frequent mismatch patterns and examples are in the summary.
5. **Point in time:** **0/2,437,277 printed-value violations** and **0/1,218,271 answer-key facts filed on/after the
   release**. No value was filled from `facts`.
6. **Extract:** `flash-quarter-rest.jsonl` has one row per release. Quarter revenue is present for **13,502/31,258
   (43.1953%)**, year-ago revenue for **13,482 (43.1314%)**. Of 9,164 gradable revenue values, **9,087 match
   (99.1598%)**. Full year/sector coverage is in the summary; local `companies.sector` was read only at
   `2026-11-17T21:54:00.062Z`, classifying 448/450 companies with releases and leaving two unclassified.
7. **Verification:** targeted flash suites **5 files / 48 tests**, full suite **261 files / 1,472 tests**, `npm run
   check`, `npm run build`, and `git diff --check` passed. Build emitted only the established chunk-size warnings.

The summary's own `acceptance.pass` is **true**. Claude's subsequent independent review is recorded below: K12 is
accepted with conditions and a 28-company quarantine.

### Artifacts and repeatability evidence

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `D:\research\alpha-engine\engine\flash-rest\statements.jsonl` | 160,977,095 | `ce74a82b63742ee8ebd95ead447a130b336d890e3719392f9edc90651428e278` |
| `D:\research\alpha-engine\engine\flash-rest\values.jsonl` | 3,097,624,081 | `655f749c500dd5863395ead25a2a3e92f78ce3321ef066857a8d4970c1951aee` |
| `D:\research\alpha-engine\engine\flash-rest\grades.jsonl` | 550,446,661 | `498b44621dc86244323beaa7fe42a8d4a6752f7ede35d719c8741fae47229b1a` |
| `D:\research\alpha-engine\engine\flash-rest\residual.jsonl` | 836,857,438 | `8ca469eeddfde0d85357ade6162a5d90f237b8d68443053557e71a12c6ff8eb1` |
| `D:\research\alpha-engine\engine\flash-rest\flash-quarter-rest.jsonl` | 54,116,905 | `b04948489cb5e4b44f79ec9fb5ecb902da1423d4ce284d7a507b57513cdce9a9` |
| `D:\research\alpha-engine\engine\flash-rest\manifest.json` | — | `7df002d21c2ac2e6a9cd01015ea37abfec06e3928cea8be9e3fe3425d5635c8b` |
| `research/engine/flash-statements-rest.summary.json` | — | `4c53bc8781bd778555b35ec4f334351f31b61546663b9e86e579d20ff2b0fadd` |
| `research/engine/flash-statements-50.summary.json` | — | `e26d4756918d4bf538d0ea674ced748ef596b79c5d0c42222f40bcdef2e9a2b3` |

Only cached HTML EX-99 exhibits and local MySQL facts were used. Page images, 8-K-body text, non-GAAP, guidance,
segment and comparison/change tables remain outside scope. Unnamed rows remain residual; fourth-quarter three-month
values and unpaired releases are not gradable. No model call, production write, schema change, new collector or
scheduler entry occurred. These are extraction-quality results, not alpha evidence.

## Independent review and conditional acceptance — 2026-11-17T22:45Z (Claude)

Mailbox review: `worker/.runs/bridge/to-kimi/20261117-224500-claude-k12-full-run-review.md`.

**Verdict: accepted with conditions.** The 452-company run at code hash `6571aaaa…` is accepted as a research artifact
with the quarantine below. The changed default 50 is accepted as the versioned K03 correction, except COP, which is
quarantined. Claude independently matched all eight reported artifact/summary hashes, recomputed the 98.0703% grade,
confirmed the printed-cell and point-in-time checks, and found no newly mismatched default-50 release; 17 releases are
newly matched.

The original period rule passes at **25,391/25,574 = 99.2844%**. Claude's stricter chosen-income-statement rule passes
at **25,273/25,574 = 98.82%**; in 224 releases the chosen statement has no current column at K06's `fiscalPeriodEnd`.
Both figures are acceptance evidence and must be retained.

### Defects found by independent review

1. **TDG:** current and year-ago revenue and operating income are swapped in every fiscal-Q4 release from 2015–2026.
   Q4 values are not gradable, so the grade gate does not detect this.
2. **COP:** the default-50 regression remains in the Detailed Supplemental Information year-row over 1st–4th Qtr/YTD
   layout. Columns are dated to the wrong year, and share counts under `(in thousands)` are unscaled. COP has 178
   mismatches among 326 gradable values, versus 4 among 10 in K03.
3. **Balance-sheet scale:** the thousands/millions multiplier is missed for ATO (60 values) and KMB in 2010–2011 (32).
4. **Column dating:** about 20 companies have material period misdating. Gradable mismatch share exceeds 10% in 21
   companies; 3,390 of roughly 4,500 of those mismatches equal the same concept in another period. The worst affected
   companies are DOW, DD, XOM_PRE, CBOE, BEN, VTR, TPR, OXY, PSX, WY, MRK and CL. Extract revenue is misdated in 20/29
   DOW rows, 9/20 DD rows and 15/50 CBOE rows.

### Mandatory quarantine

Quarantine file: `D:/research/alpha-engine/engine/checks/k12-review/quarantine.json`. Exclude these **28 companies**
from engine use of K12 release figures until a fix is verified:

`AMAT, ARES, ATO, BEN, CBOE, CL, COP, DD, DOW, EXE, FICO, FITB, HIG, KMB, LYB, MRK, OXY, PEG, PODD, PSX, RVTY, TDG,
TKO, TPR, VTR, WMB, WY, XOM_PRE`.

Claude applies the quarantine on the engine side in the lab. The existing K12 artifacts are not modified. Nothing from
K12 reaches `alpha_research` or production until that engine-side quarantine is in place.

The exact parser source and test were committed unchanged as `adc28bcec8dacd298dd3abbf5cbd428117a19c36`. Recomputing
the build-script hash from that commit returns `6571aaaa97dffdf216e92430cd2397ead9f027eee96f0ffbace238f605dd07a3`.
The artifact manifest's `codeCommit=c58c5e0` is therefore a stale base-commit field; its content code hash is the
authoritative match to `adc28bc`. No rebuild was run. Optional K12.1 is left to Claude; no new run was started.


## K12.1 fixes and re-review — 2026-11-18 (Claude)

Parser commit `876594bc9bf8d3192dda87091a54507353dfce51` (`worker/lib/flash-html.ts`, six new fixture tests, each
failing on `adc28bc`). Build-script hash from that commit: `7f76b2c2d5f3b2facd14dd24f93d94030132f861c861125f88f342c3e3195866`,
equal to both manifests below (their `codeCommit=56e249c` is again the stale base-commit field).

Fixes:
- A dated title in the label column is not a value column when the value columns carry their own period headers
  (TDG Q4 swap, CBOE). It stays the period of a consolidating table whose columns are segments (EXC, ETR) and is the
  last resort when nothing else yields a column (CL).
- A date or year row printed one group left of its duration row is moved back (DOW, DD).
- A YTD column under an earlier year is that year's full year when its group prints a 4th quarter, otherwise the same
  year-to-date span earlier (COP supplemental layout).
- Units "Millions of Dollars", "(000s)" and a row or heading "(in thousands)" are read; the first unit phrase wins
  (COP shares, ATO, KMB).

New builds (the accepted `flash-rest` and `flash` stay unchanged):

| | accepted 452 (`flash-rest`) | K12.1 452 (`flash-k121b-rest`) | accepted 50 (`flash`) | K12.1 50 (`flash-k121b-50`) |
|---|---:|---:|---:|---:|
| grade match share | 98.07% | 98.45% | 98.35% | 98.50% |
| mismatches | 17,097 | 14,491 | 1,869 | 1,818 |
| period matched | 25,391 / 25,574 | 25,390 / 25,574 | 2,949 / 2,957 | 2,949 / 2,957 |
| errors, PIT violations | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| golden | 113/113 | 113/113 | 113/113 | 113/113 |

- Release-by-release diff: no default-50 release changes its period; in the 452 one release changes, PSX
  0001534701-26-000020, whose income table is a 2025 recast without the current quarter (the old match came from two
  YTD columns both given the expected date). The first K12.1 run (`flash-k121-rest`) lost 52 ETR/EXC releases and one
  CL release; the narrowed rule restores all of them.
- Extract against SEC companyfacts (452, Q4 included): revenue 99.26% (was 98.76%), operating income 98.86% (98.53%),
  net income 95.48% (94.99%), diluted EPS 90.61% (89.96%). TDG's fiscal-Q4 revenue now chains year to year.
- Removed values are wrong ones: AMAT loses 93 matches and 221 mismatches; no other company loses more than 10 matches.

Quarantine, the same rule re-applied to both K12.1 builds:
`D:/research/alpha-engine/engine/checks/k12-review/quarantine-k121.json` (sha256 `f51f9742…`), **13 companies**:
`BEN, COF, COP, EXE, FITB, HIG, LYB, PODD, PSX, RVTY, TKO, WMB, WY`. Released: AMAT, ARES, ATO, CBOE, CL, DD, DOW,
FICO, KMB, MRK, OXY, PEG, TDG, TPR, VTR, XOM_PRE. COF was already over the line in the accepted 50 (263 of 2,408) and
was missed because the first quarantine was computed on the 452 run only. COP improves from 178/326 to 62/571
mismatches and stays just over. ATO and KMB each keep one release with a missed unit. The old `quarantine.json`
applies to `flash-rest` only. Engine use of the K12.1 builds requires the new file.
