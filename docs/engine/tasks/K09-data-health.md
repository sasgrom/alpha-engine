# K09 — Data-health checks with quarantine (Stage 3, step A)

Task for Kimi Code, after K07 and K08. Design agreed by the owner on 2026-11-11 (manual §2.1): purification
starts with correctness; inputs that fail a check are set aside before the engine or the app uses them.

## LLM use

None.

## Goal

One local builder, run by the scheduler after the daily data jobs, that checks every source the engine reads
and writes two files:

- `public/reports/data-health.json` and `.md`: per check, what was examined, what failed, since when, with the
  evidence (dates, values, file or accession).
- `research/engine/quarantine.json`: the machine-readable list of inputs set aside, one entry per item
  (`source`, `key` such as cik and date or accession, `check`, `severity`, `since`, `evidence`). The engine
  (Claude's lab) and later the app read it; this task does not change how they use it.

Operations shows the summary line and links to the report.

## Checks (each with a regression test built from a real case found on 2026-11-11)

Prices (`prices`, sources `stooq`, `schwab`, `schwab-hist`):

1. **Two sources, one story.** Per series and date, Stooq close / Schwab close changes only in steps that a
   dividend explains (ratio never above one beyond rounding, rising towards the present, no step above 15%);
   anything else is a finding. Test: KO steps pass; a planted 2:1 step fails.
2. **Splits from the quotes.** The option-implied price (DoltHub features schema 3, `spotSource = put-call
   parity`, unadjusted) against Schwab's split-adjusted close gives the cumulative split factor per date; a change
   by a clean ratio marks a split date (write the split table found); any other change is a finding. Test: AAPL
   4:1 on 2020-08-31 and NVDA 10:1 on 2024-06-10 found.
3. **Bars:** non-positive values, high below low, unchanged OHLC with zero volume over 3+ sessions, one-day moves
   beyond ±50% with no split or corporate action found (review, not removal). Test: the 22 high-below-low bars of
   the 2026-10-26 Stooq dump.
4. **Gaps:** sessions of SPY's combined Stooq + Schwab calendar since 2006-11-10 that a series lacks inside its own
   span, excluding `schwab-hist` (23 series today, CHTR 25 missing sessions over its span, the first five in
   December 2009).

Filed figures (`facts`, `series_points`):

5. **Non-additive concepts** (average share counts, per-share values) never carry a derived quarter. Test: AAPL
   2026-09-26 −30 M diluted shares (until K08 corrects the builder, this check must find it).
6. **Units and signs:** a value 1,000 times off the company's own neighbouring values, negative revenue, share
   counts or assets.
7. **Restatements:** latest vintage against first filed beyond 10% for income-statement totals (report only).

Filings and calendar:

8. **Out-of-order and duplicate periodic filings** from the K06/K01 anomaly lists (`outOfOrderNextPublications`,
   `duplicateOriginalPeriods`): TMUS 2006 and TXN 2010-06-30 appear in the report.

Model output:

9. **Unverifiable statements:** guidance statements whose quote is not in the source document are counted per
   release (the second pass already rejects them; the report shows the share per company).

Options:

10. **Snapshot health:** quote-derived spot present, implied volatility within 0.03–4, at-the-money strike within
    5% of the spot.

## Rules

- Checks read only; nothing is deleted or rewritten. The quarantine is a list, not an edit.
- Point in time: a finding is dated by when it became knowable; the quarantine never hides data retroactively
  from a backtest without recording the date it was found.
- No production write, no schema change, port 3000 only, D: guards for raw files.

## Acceptance checks

1. Each check has its real-case regression test (above) and a clean-case test.
2. A full run over the local data finishes in under 15 minutes and lists, for 2026-11-11 data, at least: the
   AAPL derived quarter (until K08), the 23 gap series, TMUS and TXN, the PG 1987 bar and BNY 1989–1995 steps
   (now in the accepted history: shown as reviewed, severity info).
3. Scheduler job registered with `dependsOn` on the daily data jobs; Operations shows the summary line.
4. `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`.

## Delivery

Delivery report in this file (checks, counts per check, the split table found, run time), the usual handoff
note, and a mailbox message to Claude.


## Delivery report — 2026-11-12 (source c4244b9)

### Implementation and scope

Ten deterministic, read-only health checks now cover prices, filed figures, filing calendar, model evidence and option snapshots. The builder writes public JSON/Markdown reports and a machine-readable quarantine inventory with source, key, check, severity, since and evidence. It never deletes or rewrites source data. Operations shows the summary and links both report formats; the report policy is local-only (`automatic: false`).

The option checkpoint is valid only when the schema-3 feature-manifest generation and latest Schwab session still match. Otherwise the builder recomputes it. The latest option checkpoint took 1,283,136 ms to build under shared database contention. The resumed full run took **665.421 s**, within the 15-minute acceptance limit, and records `reused_current_checkpoint`. This is checkpointed resumption, not a hidden reduction of the input set.

### Check results

**95,997 findings**: 58,990 quarantine, 36,306 review and 701 reviewed/info. Findings are expected evidence of bad inputs, not builder failures.

| Check | Examined | Findings | Quarantine | Review | Info |
|---|---|---:|---:|---:|---:|
| two_sources_one_story | 48845 differing ratio steps | 48854 | 48845 | 0 | 9 |
| splits_from_quotes | 564538 quote/close pairs | 36147 | 0 | 36081 | 66 |
| bars | 0 current invalid bars, 197 large moves, 0 zero-volume runs | 219 | 22 | 197 | 0 |
| gaps | 23 series with missing sessions | 23 | 0 | 23 | 0 |
| non_additive | 70 derived non-additive points; AAPL derived quarters after K08: 0 | 70 | 70 | 0 | 0 |
| units_and_signs | 59 neighbour-scale candidates, 10 negative values | 135 | 127 | 0 | 8 |
| restatements | 618 changes above 10% | 618 | 0 | 0 | 618 |
| calendar | 156487 filings in the K06 inventory | 5 | 0 | 5 | 0 |
| expectation_evidence | 26787 extraction results | 5437 | 5437 | 0 | 0 |
| snapshot_health | 610034 snapshots / 1225501 buckets | 4489 | 4489 | 0 | 0 |

Required evidence is reproduced: 23 gap series with **CHTR = 25 missing sessions**, first five in December 2009; TMUS 2006 and TXN 2010-06-30; PG 1987-10-19 with a 16.4046% archive step and eight BNY 1989–1994 steps above 10%, all reviewed/info; all 22 high-below-low rows from the old Stooq dump; AAPL 4:1 and NVDA 10:1 from option quotes. AAPL's K08 derived-quarter problem is now **0**; the other local universes retain 70 derived non-additive findings. There are 6,787 rejected extraction statements across 26,787 extraction results, with per-company shares in the report.

### Option split table found

66 clean split events were found from put-call parity spot versus Schwab's split-adjusted close. The full table is below; unclean changes remain findings and are not presented as splits.

| Series / date | Ratio | Previous factor → current | Option spot | Schwab close | Error |
|---|---:|---:|---:|---:|---:|
| AAPL|2020-08-31 | 4 | 4 → 1 | 129.275 | 129.04 | 0 |
| AMCR|2026-01-16 | 0.2 | 0.2 → 1 | 41.275 | 40.94 | 0 |
| AMZN|2022-06-06 | 20 | 20 → 1 | 124.9 | 124.79 | 0 |
| ANET|2021-11-19 | 4 | 15.988794669897032 → 4 | 129.375 | 32.24 | 0.000700333131435471 |
| ANET|2024-12-04 | 4 | 4 → 1 | 105.65 | 105.43 | 0 |
| APH|2021-03-05 | 2 | 8.01431980906921 → 4 | 62.05 | 15.39 | 0.0017899761336512832 |
| APH|2024-06-12 | 2 | 4 → 2 | 68.77499999999999 | 34.345 | 0 |
| APH|2026-09-03 | 2 | 2 → 1 | 80.64999999999999 | 82.07 | 0 |
| AVGO|2024-07-15 | 10 | 10 → 1 | 171.64999999999998 | 171.42 | 0 |
| BDX|2026-02-11 | 1.25 | 1.25 → 1 | 180.2 | 180.62 | 0 |
| BDX|2026-03-09 | 0.8 | 1 → 1.25 | 207.19500000000002 | 165.46 | 0 |
| BDX|2026-03-10 | 1.25 | 1.25 → 1 | 164.35 | 163.88 | 0 |
| COO|2024-02-21 | 4 | 4 → 1 | 98.44999999999999 | 98.08 | 0 |
| CPRT|2022-11-04 | 2 | 4 → 2 | 57.35 | 28.69 | 0 |
| CPRT|2023-08-23 | 2 | 2 → 1 | 45.2 | 45.08 | 0 |
| CRWD|2026-07-02 | 4 | 4 → 1 | 194.69500000000002 | 193.98 | 0 |
| CSX|2021-06-30 | 3 | 3 → 1 | 32.075 | 32.08 | 0 |
| CTAS|2024-09-12 | 4 | 4 → 1 | 204.425 | 206.02 | 0 |
| CVNA|2026-05-08 | 5 | 5 → 1 | 77.955 | 77.94 | 0 |
| DD|2026-06-25 | 0.3333333333333333 | 0.3333333333333333 → 1 | 137.75 | 137.8 | 0 |
| DVN|2020-04-15 | 0.8 | 2.4422110552763816 → 3 | 8.690000000000001 | 2.94 | 0.017587939698492233 |
| DXCM|2022-06-13 | 4 | 4 → 1 | 68.2 | 68.06 | 0 |
| ETR|2024-12-13 | 2 | 2 → 1 | 74.275 | 74.24 | 0 |
| EW|2020-06-01 | 3 | 3 → 1 | 74.22 | 74.27 | 0 |
| FAST|2020-01-06 | 2 | 4 → 2 | 36.025 | 18 | 0 |
| FAST|2025-05-22 | 2 | 2 → 1 | 40.9 | 40.715 | 0 |
| FDX|2026-06-02 | 1.25 | 1.25 → 1 | 330.275 | 329 | 0 |
| FTNT|2022-06-27 | 5 | 5 → 1 | 58.95 | 58.85 | 0 |
| GE|2024-04-03 | 1.25 | 1.25 → 1 | 146.035 | 145.62 | 0 |
| GOOG|2022-07-18 | 20 | 20 → 1 | 110.10000000000001 | 109.91 | 0 |
| GOOGL|2022-07-18 | 20 | 20 → 1 | 109.15 | 109.03 | 0 |
| IBKR|2025-06-18 | 4 | 4 → 1 | 52.85 | 52.6 | 0 |
| ISRG|2021-10-06 | 3 | 3 → 1 | 335.3 | 334.94 | 0 |
| LRCX|2024-10-03 | 10 | 10 → 1 | 81.425 | 81.11 | 0 |
| MCHP|2021-10-13 | 2 | 2 → 1 | 70.14999999999999 | 70.25 | 0 |
| MKC|2020-12-02 | 2 | 2 → 1 | 91.35000000000001 | 91.42 | 0 |
| MNST|2023-03-29 | 2 | 4 → 2 | 52.325 | 26.075 | 0 |
| MNST|2026-08-12 | 2 | 2 → 1 | 45.550000000000004 | 45.98 | 0 |
| NCLH|2020-03-23 | 0.8 | 1 → 1.25 | 12.024999999999999 | 9.67 | 0 |
| NCLH|2020-03-25 | 1.25 | 1.25 → 1 | 16.725 | 16.96 | 0 |
| NDAQ|2022-08-29 | 3 | 3 → 1 | 59.625 | 59.7 | 0 |
| NEE|2020-10-28 | 4 | 4 → 1 | 74.525 | 74.46 | 0 |
| NFLX|2025-11-17 | 10 | 10 → 1 | 110.48 | 110.29 | 0 |
| NOW|2025-12-18 | 5 | 5 → 1 | 153.79999999999998 | 153.38 | 0 |
| NVDA|2021-07-21 | 4 | 39.99121394054767 → 10 | 194.13 | 19.41 | 0.00021965148630831433 |
| NVDA|2024-06-10 | 10 | 10 → 1 | 122.05 | 121.79 | 0 |
| ODFL|2020-03-27 | 1.5 | 3 → 2 | 128.85 | 64.165 | 0 |
| ODFL|2024-04-01 | 2 | 2 → 1 | 218.9 | 218.12 | 0 |
| PANW|2024-12-16 | 2 | 2 → 1 | 202.79999999999998 | 202.5 | 0 |
| PCAR|2023-02-10 | 1.5 | 1.5 → 1 | 72.8 | 72.99 | 0 |
| RJF|2020-01-06 | 0.6666666666666666 | 1 → 1.5 | 88.875 | 59.24 | 0 |
| RJF|2021-09-24 | 1.5 | 1.5 → 1 | 92.925 | 93.13 | 0 |
| ROL|2020-12-16 | 1.5 | 1.5 → 1 | 39.325 | 39.12 | 0 |
| SHW|2021-04-05 | 3 | 3 → 1 | 255.77000000000004 | 255.9 | 0 |
| SMCI|2024-10-01 | 10 | 10 → 1 | 40.699999999999996 | 40.55 | 0 |
| SRE|2023-08-23 | 2 | 2 → 1 | 72.125 | 71.86 | 0 |
| TECH|2022-11-30 | 4 | 4 → 1 | 85.125 | 84.99 | 0 |
| TPL|2025-12-23 | 3 | 3 → 1 | 296.57000000000005 | 297.33 | 0 |
| TSCO|2024-12-20 | 5 | 5 → 1 | 54.65 | 53.92 | 0 |
| TSLA|2022-08-26 | 3 | 3 → 1 | 288.42999999999995 | 288.09 | 0 |
| WMT|2024-02-26 | 3 | 3 → 1 | 59.69 | 59.6 | 0 |
| WSM|2024-07-10 | 2 | 2 → 1 | 146 | 146.24 | 0 |
| XLB|2025-12-05 | 2 | 2 → 1 | 43.925 | 44.09 | 0 |
| XLE|2025-12-05 | 2 | 2 → 1 | 46.05 | 45.92 | 0 |
| XLK|2025-12-05 | 2 | 2 → 1 | 146.935 | 146.6 | 0 |
| XLY|2025-12-05 | 2 | 2 → 1 | 121.125 | 119.73 | 0 |

### Option health and accepted history

- All **610,034 snapshots / 1,225,501 buckets** received spot-source and ATM-IV checks.
- ATM strike used put-call parity on the first option trading day of each month plus the latest date: **94 dates / 41,874 checks / 41,571 pass / 303 findings**. Keeping strikes in feature JSONL would be schema 4 and is outside K09.
- PG and BNY retain owner-accepted history as severity info, with acceptance-file generation timestamps and old/new archive hashes. No suppression rule was added.
- The old dump's 22 invalid bars remain quarantine evidence with their original values; the current archive is not silently blamed for them.

### Scheduler and live verification

- The existing scheduler was restarted at 2026-11-12T09:25:03Z after its queue was empty and reports **78 registered jobs**. `data-health` is enabled with dependencies on research-series, schwab-daily-bars, edgar-exhibits-daily and schwab-feature-lab. No parent collector was triggered merely to force this task. The registered job will run when that normal dependency chain completes; no scheduled lastRun is claimed here.
- The joint web restart used one listener, pid 6812 → **2620**, HTTP 200. Live Operations shows **10 checks · 95,997 findings · 58,990 quarantine · 36,306 review · 701 reviewed/info** with Markdown and JSON links. Final auth is 200 and there are no page errors or failed requests.
- Verification: `npm run check`, **224 files / 1,262 tests**, `npm run build`, `git diff --check`, K09 script typecheck and **31 focused tests** pass. The report verifier is **13/13 pass**, including runtime, counts, required evidence and hashes.

### Evidence hashes

| File | Bytes | SHA256 |
|---|---:|---|
| public/reports/data-health.json | 235,311 | `d8174cc26b6ce27be316d538c1241e9f71e228c21fd1d842294b8c1643bd0671` |
| public/reports/data-health.md | 75,819 | `608ee2a458dbad134487ede9daf000b19607f3a877dd247c51540f64d377bcf7` |
| research/engine/quarantine.json | 32,574,576 | `c2095b4624acf6b933cd38c914cdb3ed8788fa7f2e9efc78b8cd95ca3d23b010` |
| research/engine/data-health-verification.json | 2,279 | `2549d4f82a6faf52b18b1f7c2c5e90b91c0e136996860ac0939828cb0f88d2e3` |
| research/engine/data-health-live-check.json | 513 | `27f73fb81a9aed6427f2b38a78326ef1741c0be6452f8c649e271abb301e8618` |

### Boundaries and next action

Only local files and read-only database queries were used. No production write, deployment, schema change, new table/index, LLM call, GDELT request or alpha promotion occurred. Unrelated generated exposure/analytics changes remain uncommitted.

Next, let the registered scheduler run satisfy its normal parent chain and inspect its lastRun record. Reuse the option checkpoint only while its inputs match. A future schema-4 feature format could retain parity strikes, but that is a separate owner decision, not K09 work.
