# K18 — Weekly refresh of the standard prices

**Owner's approval:** 2026-11-13 afternoon ("ok" to the weekly rebuild). **Author:** Claude. **Coder:** Kimi.
**Order:** after K16.4, before K19. K19 needs prices through the current week.
**Scope:**
- an orchestration script and a loader change in the lab (`C:\dev\alpha-engine-lab\src\prices\`);
- a scheduler job and a collector universe change in the main repository;
- documentation.

**LLM use:** none.

## 1. Why

`alpha_research.std_prices` (build p1.1) ends on 2026-11-12. New sessions, dividends and splits must enter it the way
the first build was made. One full, gated rebuild a week is simpler and safer than daily appends: as-traded bars do not
change once written, so a rebuild rewrites identical history and adds the new weeks. SanDisk's 8-for-1 split on
2026-11-20 is the first live case.

## 2. The chain

All the steps exist. This task orders, checks and schedules them.

1. **Yahoo corporate actions for the universe:**
   - Command: `python -I C:\dev\alpha-engine-lab\src\prices\yahoo-actions-fetch.py <ticker list> D:\research\alpha-engine\prices\yahoo\<date> 2.5`.
   - The list is the app's registry tickers plus SPY and the sector funds, about 520 tickers (about 22 minutes).
   - Owner-approved (AGENTS.md section 2): corporate actions only, polite, one request at a time.
2. **Reconcile:** `python -I reconcile-events.py <that yahoo dir> D:\research\alpha-engine\prices\tiingo-2021 D:\research\alpha-engine\prices\options\options-split-factors.json D:\research\alpha-engine\prices\sec\split-events.json D:\research\alpha-engine\prices\events\<date>`.
3. **Export:** `npx tsx C:\dev\alpha-engine-lab\src\prices\export-app-prices.mts D:/research/alpha-engine/prices/app-db/<date>` (read-only), run from `C:\dev\alpha-engine`.
4. **Build:** `python -I std-prices.py <tiingo dir> <app dir> <events.json> D:/research/alpha-engine/prices/std-<date>`.
   - First copy `tiingo-mapping.json` from the loaded build's folder.
   - Do not copy `sessions.json`, so the calendar takes the new weeks.
   - The overrides file (`src/prices/std-prices-overrides.json`) is read as it is.
5. **Gates:** `std-prices-gates.py` on the new folder.
6. **Regression check (new).** Compare the new `gates.json` totals and the `companies.json` summary with the loaded
   build's. Refuse the load when any of these holds:
   - the total-return share of differing sessions rises by more than 0.0005;
   - option-spot passes fall by more than 2;
   - any split fails its move;
   - unexplained steps rise by more than 5;
   - any carried-forward line misses today's basis;
   - empty sessions rise by more than 200;
   - a company present before is missing.
7. **Load without a gap for readers (loader change).** Today `load-mysql.mts --replace` truncates the tables and refills
   them over about 36 minutes, so a reader in that window sees part of a build.
   - Load into staging tables (`std_prices_next`, `std_price_companies_next`, `std_price_builds_next`).
   - Run the read-back of 2,000 random rows and the counts on the staging tables.
   - Then swap with one atomic `RENAME TABLE`, and drop the old tables after the swap.
   - The build version is `p1.<yyyymmdd>`, status `provisional`, and the build row is written last.
8. **Report:** a JSON summary in `worker/.runs/local-generated/std-prices-refresh.json`: inputs, counts, the regression
   check, the load line, durations.

## 3. Coverage of companies outside the S&P 500 (decided by Claude)

- **The gap:** companies in the app's registry with a price series but outside the S&P snapshot, the 50 and the funds
  have no Schwab history. Rivian and Enlight have Stooq only, ending 2026-10-26, so `std_prices` has no series for them.
  K16 found them through fund holdings.
- **The fix:**
  - Every registry company with a price series joins the daily Schwab price-history fetch and `schwabPriceSeries()`
    (`worker/schwab-daily-bars.mts`).
  - Run the existing `worker/schwab-history-backfill.mts` once for them.
  - List the companies added.
  - From the next weekly build on, they get standard series like the rest: the builder already handles companies
    without Tiingo.
- **Market data only,** as AGENTS.md requires. Pace and token handling stay as in the existing collectors.

## 4. Scheduler

- New job `std-prices-refresh` in `contracts/operations.ts`:
  - group `research`, cron Sunday 02:00 local;
  - requirements network and driveD; no `dependsOn`;
  - runtime about 70 minutes.
- Follow the existing job patterns and tests. `docs/OPERATIONS.md` gets a row and a short section.
- **Scheduler restart:** the running scheduler must load the new job. Claude restarts it after review; tell Claude in the
  delivery.

## 5. Rules

- No production write and no `alpha_engine` writes. The price scripts' logic stays unchanged, apart from the loader
  change of step 7. A real defect found on the way goes to Claude with evidence, not into the scripts.
- **Failures:** a failed step stops the chain with an honest job error. The previous build stays loaded; the swap never
  happens after a failure.
- **D: interruptions** follow AGENTS.md section 3.1: stop, keep the partial folder, never rebuild on C:.
- **Outputs** stay on D:, one dated folder per run. Old folders are kept; deletion is the owner's call.

## 6. Acceptance

1. One full manual run, end to end, with its summary JSON. The new build ends on the latest completed session.
2. The regression check refuses a deliberately worse `gates.json`, shown by a test or a dry run.
3. The swap:
   - a test shows that a reader during the load sees the old build complete, and after the swap the new one;
   - a failed read-back leaves the old tables in place.
4. The added companies are listed with their first and last Schwab dates. Rivian and Enlight have standard series.
5. Job tests green; gates `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send
   Claude a note before the full run, the build and the commit.
6. Commits:
   - lab: the orchestration and the loader;
   - main: the job, the collector universe, `docs/OPERATIONS.md`, a short section in `docs/engine/STANDARD_PRICES.md`
     and a handoff section.
   Then a mailbox message with the counts and the regression numbers.
