# K24 — Owner-only reports and an honest macro status (server side of K17b)

**Owner:** 2026-11-23, "do we have work for kimi?" and "lets do the complete move one by one". **Author:** Claude.
**Coder:** Kimi. **LLM use:** none. **Plan:** `docs/desk/UI_MIGRATION.md` section 7.

Claude is building the desk Operations console itself (K17b sections 2 and 3: the page, its tabs, the redirects). This
task is the server side that K17b section 1 specified and nobody built. It touches no desk page.

## 1. What to build

Exactly K17b section 1 (`docs/engine/tasks/K17b-desk-operations-console.md`), both parts:

1. **Owner-only reports.** `/reports/<name>` admits any reviewer who accepted the NDA, including the owner's operations
   reports. Add an access level (`owner` or `reviewer`) to `REPORT_FILE_POLICY` (`contracts/report-files.ts`);
   `reviewerReportAccess` (`api/services/reviewer-http.ts`) answers 403 to a non-admin for an owner report.
   - Owner reports: `daily-operations.*`, `weekly-coverage.*`, `data-health.*`, `universe-coverage-50.json`,
     `project-strength-review.md`.
   - Every other report stays reviewer-readable only if a page a reviewer can open reads it. List each report, its
     level and the page that reads it in the delivery.
2. **Honest macro status.** The daily report shows CRITICAL for most of every day because `derivedCheck`
   (`worker/lib/macro-operations-health.ts`) compares run times: the macro QA re-runs at 05:55, after the night chain
   built the derived reports. A derived report is stale only when an input it reads changed content after it was
   built. If a builder does not record the hashes of its inputs, add that to the builder.

## 2. Boundaries

- **Do not touch** (Claude is working in them): `src/desk/**`, `src/App.tsx`, `worker/lib/adjusted-eps*.ts`,
  `worker/lib/desk-company*.ts`, `scripts/build-adjusted-eps.mts`, `scripts/build-desk-company.mts`,
  `contracts/desk-company.ts`, `api/routers/desk.ts`, `docs/desk/UI_MIGRATION.md`.
- Nothing in `api/lib/`, `api/kimi/`, `.env`; no schema change; no production write; no scheduler or web restart
  (Claude restarts after review, and says so in the mailbox first).
- Commit only your own paths (`git commit -- <paths>`): the working tree holds Claude's uncommitted work.

## 3. Acceptance

1. Tests: a reviewer gets 403 for each owner report and 200 for a reviewer report; the owner gets 200 for both. A QA
   re-run over the same inputs leaves a derived report current; a changed FRED or OFAC input makes it stale; a failed
   QA still fails.
2. Gates: `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send Claude a
   mailbox note before the full test run and the build.
3. One commit with the code, the tests and a handoff section; fast-forward push when only your commit is ahead.
4. A mailbox message: the commit, the report access list, and the status the rebuilt daily report shows.
