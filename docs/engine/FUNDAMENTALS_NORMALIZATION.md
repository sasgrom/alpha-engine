# Fundamentals step 2 — the normalized panel: how it is built, checked and kept

Owner's instructions, night of 2026-11-14:
- "clean and normalize data before the first test";
- "scientifically account for highly correlated factors or factor derivatives as they just make such factors count k
  times more";
- "dont make things up, all data must be verified, bad and good";
- "go on with the flow ... just dont overwrite the data".

Step 1 (the standard series) is `STANDARD_FUNDAMENTALS.md`. This document is the process for step 2, so that it can be
repeated for new quarters and companies.

- **Code:** lab `C:\dev\alpha-engine-lab\src\fundamentals\`: `normalize_lib.py` (rules, unit-tested by
  `test_normalize_lib.py`), `normalize.py` (build), `normalize_gates.py` and `norm-audit.mts` (gates),
  `normalize_corr.py` (correlation), `normalize_export.py` and `load-norm-mysql.mts` (MySQL).
- **Data:** `D:\research\alpha-engine\fundamentals\normalized\<version>\`.
- **Findings of the first build (n1), step by step:** lab `docs/findings-fundamentals-n1-2026-11-14.md`.

## 1. What the panel is

- **Rows:** one row per company, decision day and ratio.
  - Decision day: the last SPY session of each month.
  - Columns: the raw ratio (`value`), the ratio clipped at that day's 1st/99th percentile (`w`), its z (`z`), its rank
    among all companies that day in (0, 1) (`rnk`), and its rank inside its GICS sector when the sector has 5 or more
    companies that day (`srnk`).
- **Per company and day:** the quarter used and its filing, the lag, the as-traded close, the shares (estimate, filing,
  split factor, check), the market cap and the EPS TTM on the day's basis.
- **The ratios (39 in 11 families):** see `definitions.json` and `normalize_lib.RATIOS`. Banks and insurers (GICS
  Financials) get no industrial ratios (gross margin, current ratio, EV, ...).
- **Point in time:**
  - A version counts only if it was filed **before** the decision day, and a quarter only after its own first filing.
  - Decide at the close, trade at the next open.

## 2. Inputs (read only)

- **Fundamentals:** a final build of step 1 (n1: `standard\v3.1`).
- **Prices:** standard prices (n1: p1.1, `prices\std\daily\<cik>.csv`) for the as-traded close, `splitIndex` and
  `trIndex`.
- **Sectors:** GICS sector and industry from the app's `alpha_engine.companies`, plus the price quality from
  `std_price_companies`, exported by `norm-inputs.mts`.
- **Documented exclusions** in `<version>\inputs\`, each with its evidence:
  - `ttm-exclusions.json`: fiscal year × field whose TTM fails the 10-K tie-out (gate G8 of pass 1);
  - `mcap-exclusions.json`: companies whose share count is not the traded class.

## 3. The steps, with commands

Run from `C:\dev\alpha-engine`. `N1` is the output folder.

| # | Step | Command |
|---|---|---|
| 1 | Inputs | `npx tsx C:/dev/alpha-engine-lab/src/fundamentals/norm-inputs.mts N1` |
| 2 | Unit tests | `python -I -m pytest -q C:/dev/alpha-engine-lab/src/fundamentals/test_normalize_lib.py` |
| 3 | Pass 1 build (no `ttm-exclusions.json`) | `python -I -B normalize.py <fundamentals build> <prices std> N1` (about 4.5 min) |
| 4 | Audit samples | `python -I -B normalize_gates.py samples N1 <fundamentals build>` |
| 5 | SQL audits | `npx tsx C:/dev/alpha-engine-lab/src/fundamentals/norm-audit.mts N1` |
| 6 | Gates | `python -I -B normalize_gates.py report N1 <fundamentals build> <prices std>`, which also writes `ttm-tieout-failures.json` |
| 7 | Exclusions | write `inputs/ttm-exclusions.json` from the failures (each with ttm, annual10k and relDiff), then repeat steps 3-6 as pass 2 |
| 8 | Correlation | `python -I -B normalize_corr.py N1` |
| 9 | Export and load (committed code only; the loader refuses a dirty build) | `python -I -B normalize_export.py N1`, then `npx tsx .../load-norm-mysql.mts N1 provisional` |

Python must find pyarrow and pytest with `-I`: install them into the interpreter's own site-packages
(`pip install --no-user --ignore-installed ...`), because `-I` ignores the per-user site.

## 4. The rules (normalize_lib.py)

1. **Point in time.** The latest version filed before D for each field and quarter.
   - A quarter "filed" on or before its own end counts from its first real version (AES Q1 2025 is on its Q3 2025
     slot).
   - A latest quarter older than 200 days at D is stale, and nothing is used.
2. **TTM.** Flows are summed over the latest four quarters known at D.
   - The four must follow each other (start = previous end + 1, up to 7 days of tolerance) and span 350-380 days.
   - "A year earlier" is the quarter four steps back, as known at D.
3. **Share basis.** Counts and per-share amounts are on their filing date's basis and are moved to D's basis with
   `splitIndex`.
   - When a split takes effect within 60 days after a filing, the filing may already show it (declared before,
     effective after: AOS 2013). The basis then follows the earlier quarters' agreed counts.
4. **Share counts.** Three estimates per quarter: balance sheet (else cover), weighted average, and net income ÷
   filed basic EPS (an EPS derived by an identity does not count).
   - Estimates that put price-to-sales outside 0.005-2,000 are dropped when another one stays inside (price-to-assets
     0.002-500 when there is no revenue).
   - Estimates 100× or more from the median of up to four earlier agreed counts are dropped.
   - Two estimates within 1.5× agree: the balance-sheet count is preferred.
   - Otherwise the one within 2× of the earlier counts is used, or a single estimate with no history ("unchecked").
   - Below 100,000 shares is a shell.
5. **Scale slips in values.** A version 10^2.5 or more from the median of all versions of the four quarters on each
   side is dropped. This applies to revenue, gross profit, assets, current items, cash, capex and dividends paid, and
   only when that median clears a floor.
6. **One-way lines** (dividends paid, buybacks, capex, share-based pay, R&D) are summed as magnitudes.
7. **Market cap** = as-traded close (the last session within 7 days) × shares on D's basis.
8. **Cross-section:** per day and ratio, clip at the 1st/99th percentile, then z, rank and sector rank.

## 5. Acceptance gates (n1 pass 2)

| Gate | Rule | n1 |
|---|---|---|
| G1 | unit tests | 18 / 18 |
| G2 | TTM revenue and net income of 2,000 random company-days equal an independent SQL recomputation on `alpha_research` | 0 of 3,851 different |
| G3 | across every split since 2009, market cap and P/E ÷ the price-only move show no jump by the ratio | 154 splits, 0 jumps |
| G4 | SEC public float ÷ market cap within 0.3-1.15 | 98.2% of 6,844 company-years |
| G5 | values outside wide bounds per ratio are listed with examples | residuals are real cases or fresh starts |
| G7 | calendar defects of the input build are listed | 1 (AES) |
| G8 | TTM at fiscal year ends equals the 10-K's annual fact of the same tag (SEC companyfacts) within 0.5% | 100% after the exclusions (98.9% before) |

## 6. Keeping it in MySQL (alpha_research, AGENTS.md 3.2)

New tables only; a stored version is never replaced or updated, and the build row is written last:
- `std_norm_values` (normVersion, cik, date, code, value, w, z, rnk, srnk);
- `std_norm_company_days` (the per-company-day columns of section 1);
- `std_norm_definitions`;
- `std_norm_builds` (status, code commit, inputs with SHA-256, the gates' summary).

Inserts go in batches of at most 500 rows, then the counts are checked against the export and 2,000 random values are
read back. Production only through a reviewed migration and the owner's reviewed sync.

## 7. Lessons (do not repeat)

- **Filers slip share counts by 10³-10⁶,** sometimes in both tags of the same filing (OKE 2011 10-K, GRMN 2015-18), so
  two agreeing tags are not proof. A scale-free estimate (net income ÷ filed EPS) and a price-to-sales check settle
  it. Where the tags agreed and net income ÷ EPS did not, the tags were right 28 times, the EPS count 8 times and
  2 were unclear.
- **An identity-derived value is not an independent check** of what it was derived from (COP's Q4 EPS from a slipped
  count).
- **Check splits by continuity, not by dates alone:** a filing can show a split before it takes effect.
- **Scale and sign slips** also hit balance sheets, comparatives and cash-flow lines. The neighbours' median and the
  one-way magnitude rule handle them; every dropped value is listed in `slip-defects.json`.
- **Survivors:** the universe is today's S&P 500, so small, growing or recovering companies look better than they
  were. Size "predicted" returns in the first test (t −5.5) and faded among the 300 largest at each date and towards
  2026. Get the index membership by date before testing returns on fundamentals.
