# Standard guidance — what companies said about future periods, as point-in-time rows

The guidance standard holds every statement of guidance that a local language model read out of the earnings
releases of the index companies, with the period it speaks about, the numbers, the quote it rests on and the first
session it could be acted on. This document is the process, so that the build can be repeated and its limits are
known. The current build is **g1.2.20261122, final**.

- **Code:** lab `C:\dev\alpha-engine-lab\src\research\guidance\`: `build_guidance_std.py` (the build; its header is
  the authoritative list of rules), `fiscal_calendar.py` (fiscal labels and period ends), `load-mysql.mts` (loader).
- **Data:** `D:\research\alpha-engine\guidance\std\<UTC stamp>\`; the final build is `20261123T033803Z`.
- **Tables:** `alpha_research.std_guidance_releases`, `std_guidance_statements`, `std_guidance_rejected`,
  `std_guidance_builds`, keyed by `guidanceVersion`; a stored version is never replaced.
- **Used by:** the desk Company page (guidance history), the pooled engine's stage 1, the factor tests of
  2026-11-18 (lab `docs/findings-pooled-guidance-2026-11-18.md`).

## 1. Where the statements come from

1. **Releases.** The earnings releases of the release calendar (8-K item 2.02 exhibits, cached under
   `worker\cache\edgar\<cik>\`), one record per exhibit.
2. **Extraction (GPU).** A local model (`qwen3.5:9b`) read each exhibit's guidance passages and listed statements:
   measure, basis (GAAP, adjusted, not stated), period, low/high/point, unit, and the quote. The outputs are
   `guidance-pass2\results.jsonl`, `guidance-pass2-rest\results.jsonl` and `guidance-pass2-long\results.jsonl` (a
   long-context rerun of 4,041 exhibits the first pass may have read incompletely) under
   `D:\research\alpha-engine\engine\lab\data\engine\`.
3. **Validation at extraction.** A statement is kept only when its quote is in the release and its numbers are in the
   quote. The others are written to `rejected.jsonl` for audit and are not part of the standard.

The build itself uses no model and no network: it reads those result files, the standard session calendar, the
registry, SEC companyfacts (fiscal labels) and the EDGAR filing index (transition reports).

## 2. The rules of the build

- **Availability:** the first session whose 09:30 ET open follows the SEC acceptance time (the insider standard's
  rule); never a weekend; null when the calendar does not reach it yet.
- **The release's own quarter:** its fiscal period end placed on the company's own 10-Q/10-K labels. SEC's fiscal-year
  labels are repaired first: whole-year naming changes are removed (NVDA, CRM, WMT and others around 2014; TJX 2019;
  STZ 2018; BBY 2020-2022), real fiscal-year changes stay, and before a transition report there is no label.
- **The statement's period:** read from its words on the same labels (`periodKind`, `periodFy`, `periodPart`,
  `periodHow`), and its last day (`periodEnd`: the period end of the 10-Q/10-K with that label, or counted on in
  quarters from the nearest one). `periodEnd` is the key for joining guidance to reported figures.
- **Timing:** forward, reported, earlier or undetermined against the release's own quarter. Only forward rows are
  guidance; the model sometimes listed results too.
- **Checks on the measure:** `metric_conflict` (the quote names another measure), `metric_unconfirmed`,
  `unit_mismatch`, `ffo_as_eps`, `low_above_high`, `reported_range` (a range for the quarter just ended).
- **Duplicates** inside a release carry `duplicateOf`.
- **The rerun's rows** are added only when the first pass does not have them (the union rule); `runs_disagree` marks a
  slot for which the two extractions share no value.

**The guidance view** for research and for the page: `timing = forward`, `duplicateOf` null, none of the flags
`metric_conflict`, `metric_unconfirmed`, `unit_mismatch`, `low_above_high`.

## 3. The final build in numbers

| | |
|---|---|
| Release exhibits | 48,351 (27,716 with statements, 13,354 with none, 7,281 without guidance text) |
| Statements | 176,459 (156,546 from the first pass, 19,913 added by the rerun) |
| Guidance view | 157,031 |
| Rejected at extraction (audit only) | 128,969 |
| Timing | forward 162,638 · reported 6,548 · undetermined 6,478 · earlier 795 |
| Period kind | fiscal year 125,794 · quarter 43,619 · unknown 4,121 · several periods 2,001 · half 849 · year to date 75 |
| Release's own quarter labelled | 99.95% |
| Period end | from a filed period 136,735 · counted on 33,257 · none 6,467 |

Gates (`gates.json`, all passed): releases written equal releases read; one extraction version; no availability
before acceptance and none on a weekend; every company in the registry; statement ids unique; the release's own
quarter labelled for at least 95%; rerun keys known.

## 4. Loading

```powershell
npx tsx C:\dev\alpha-engine-lab\src\research\guidance\load-mysql.mts <build folder> <provisional|final> [--complete-verified]
```

Run from `C:\dev\alpha-engine`. Batches of 500; the output hashes are checked against `build.json` before writing;
every row is read back and compared with the files; the builds row is written last. The final load (2026-11-22):
353,779 rows, of which 353,626 equal exactly, 153 to the last digit of a double, none different or missing.

## 5. What it is not

- **Not every statement a release makes.** The model read guidance passages; a long release may be cut off
  (`window_cut_off` on 21,672 rows), which is why the rerun exists.
- **Not the outcome.** Revenue and GAAP earnings per share are compared with the filed statements. Adjusted earnings
  per share, the commonest kind of earnings guidance (24,749 forward rows against 7,722 GAAP ones), have no filed
  counterpart: the reported adjusted figure is read from the releases' reconciliation tables by a separate reader
  (`scripts/build-adjusted-eps.mts`, handoff 217).
- **Revenue basis labels are noise:** the same revenue series comes out labelled GAAP, adjusted or unlabelled from
  one release to the next. Treat revenue as one series; the basis matters for earnings per share only.
- **A quote can be right and the measure another:** segment revenue, a non-comparable definition. Consumers compare
  with the reported figure and treat a difference of more than half as another measure.
- **No analyst estimates.** This is the company's own guidance, not the market's expectation.

## 6. A new build

New releases need the extraction first (GPU; the owner's go), then `python -I build_guidance_std.py` from the lab
folder with `GUIDANCE_RERUN` set when a rerun file is to be merged. The build writes a new stamped folder; nothing is
overwritten. Compare its `gates.json` and counts with the previous build's, then load it as a new version.
