# K17b — The operations console in the desk (UI move, phase 2)

**Owner's order of 2026-11-13** (backburner, Claude plans, Kimi builds): "continue with old UI functionality to be
transfered to your new design … owner tools etc that lead to the old views, re-design in new way, remove unnecessary
info and functionality add new functionality". **Plan:** `docs/desk/UI_MIGRATION.md`, phase 2. **Author:** Claude.
**Coder:** Kimi. **LLM use:** none. **Starts after K17a is accepted.**

## 1. Server-side first

- **Owner-only reports.** `/reports/<name>` admits any reviewer who accepted the NDA. That includes the owner's
  operations reports, which show job commands, machine paths and the state of every collector.
  - Add an access level to `REPORT_FILE_POLICY` (`contracts/report-files.ts`): `owner` or `reviewer`.
  - `reviewerReportAccess` (`api/services/reviewer-http.ts`) refuses a non-admin for an owner report with 403.
  - Owner reports: `daily-operations.*`, `weekly-coverage.*`, `data-health.*`, `universe-coverage-50.json`,
    `project-strength-review.md`.
  - Every other report stays reviewer-readable only if a page a reviewer can open reads it. List each report, its level
    and the page that reads it in the delivery.
  - Tests: a reviewer gets 403 for each owner report and 200 for a reviewer report; the owner gets 200 for both.
- **Honest status.** The report shows CRITICAL for most of every day from two false alarms: "Derived report predates the
  current macro QA gate" (macro scenarios, Transmission Atlas).
  - Cause: `macro-manifest-qa` re-runs daily at 05:55. The two derived reports are built earlier in the night chain, so
    `derivedCheck` (`worker/lib/macro-operations-health.ts`) compares run times and always finds them older.
  - Rule: a derived report is stale only when an input it reads changed content after it was built. A re-run of QA or
    of a collector over unchanged inputs does not make it stale.
  - If the builders do not record the hashes of their inputs, add that to them.
  - Tests:
    - a QA re-run over the same inputs leaves the derived report current;
    - a changed FRED or OFAC input makes it stale;
    - a failed QA still fails.

## 2. Desk Operations becomes the console: `/desk/operations` (owner only)

The page today is read-only and sends the owner to the classic `/workers` for every control. Tabs:

- **Health:** as now (checks, data health, scheduler line), with the corrected status.
- **Jobs:** the registry (`contracts/operations.ts`), grouped, problems first. Each job shows:
  - its schedule, or "after <parents>";
  - its children;
  - the last run, the next run, an enabled switch (`workersLocal.setOperation`), and Run and Stop.
  - **Cron edit:** inline, validated, with the next three run times shown before saving.
  - **Run** asks for confirmation and shows what will follow it (its children). **Stop** asks for confirmation.
  - Both report the scheduler's answer (queued, refused because a job runs, done). The scheduler's rules hold: one job at
    a time, and no duplicate of a running collector.
  - **Purpose, input, output, destination and notes** of each job are shown on demand. This replaces the classic
    runbook's registry list.
- **Runs:**
  - the current run with elapsed time, and the queue;
  - recent runs of all jobs, filterable by job and status;
  - a log viewer (`workersLocal.operationLog`) that follows the log while the job runs and stops polling when it ends
    or the tab is hidden.
- **Coverage:** the weekly coverage report, compact. Show what it measures, the weeks, and the gaps first.
- **Reference:** the start-up rules: one web server on port 3000, one scheduler task, and how each is started. The
  daily dependency flow, drawn from the registry, not hard-coded.

**Read-only mode:** when the server says the local worker UI is off (`workersLocal.enabled`), the controls are shown
disabled with one plain sentence why. They are never hidden.

## 3. What goes

- **The classic job launcher (`/jobs`) and its completion watcher.**
  - Evidence: the local `jobs` table holds 5 rows, all `universe-add`, the last on 2026-11-05. No other type ran.
  - **Kept:** adding a company (`universe.add`). It moves to the desk Watchlist for the owner in K17c, with its log in
    Runs. Until then the classic `/universe` keeps it.
  - **Check before removing:** confirm that no scheduled job, script or page calls the runner's job types. List what
    you checked.
  - The runner code is removed only if nothing uses it; otherwise list its users and leave it.
- **The classic run-stack drawing and the cohort-extraction runbook.** The registry's own documentation covers them; the
  extraction job stays documented in its registry entry.
- **The "Documentation mode" hero and the counters** ("GPU lanes 1", "Production cron 0").
- **Routes:** classic `/workers` and `/jobs` redirect to `/desk/operations`. Desk links that pointed to them now point to
  the new tabs.

## 4. Rules

- Follow the K17a rules:
  - desk tokens and patterns, light and dark, phone width;
  - each page ends with `DevNotes` (text in `src/desk/devnotes-data.ts`);
  - no stage labels, no machine paths in error states.
- **Carried over from K17a:** the Reviewers tab deletes through `window.confirm` (`src/desk/admin/Reviewers.tsx`). Use
  `DeskDialog`, as People does.
- **Polling:** the console polls only while visible. Health every 60 s; runs every 10 s only while a job runs.
- Nothing in `api/lib/`, `api/kimi/`, `.env`; no schema change. No production write.
- **No scheduler restart or web restart.** Claude restarts after review. A change to `contracts/operations.ts` that the
  running scheduler must read is listed in the delivery.

## 5. Acceptance

1. Report access tests (section 1) and the honest-status tests.
2. Desk tests (jsdom, `src/desk/desk-test-harness.tsx`) for each tab:
   - render and empty state;
   - Run with confirmation, Stop with confirmation, the enabled switch and the cron edit with its preview;
   - the read-only mode.
3. Redirect tests for `/workers` and `/jobs`.
4. Gates: `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send Claude a note
   before the full test run, the build and the commit.
5. One commit:
   - code and tests;
   - `docs/desk/UI_MIGRATION.md` updated (phase 2 done, what moved, what was dropped and why);
   - a handoff section.
   Fast-forward push when only your commit is ahead.
6. A mailbox message: the commit, the report access list, the job-runner check of section 3, test counts, and the new
   tabs described in light and dark.
