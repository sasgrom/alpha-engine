# K33 — Unused server procedures: inventory, then removal

Task for Kimi Code. **Owner's go of 2026-11-26** ("load him more"). Written by Claude the same day. The next step of the
project review's prune list (`docs/PROJECT_REVIEW_2026-11-22.md`, UI_MIGRATION section 7): the classic view was
deleted on 2026-11-24 (main 82ce166), so server procedures only it called are now dead code.

## Step 1 — inventory (report before removing anything)

- Every tRPC procedure in `api/routers/` and every raw route in `api/boot.ts`, with what calls it: the desk
  (`src/desk/`), the remaining pages under `src/`, workers or scripts (HTTP to port 3000), tests only, or nothing.
- For each unused one: the services it alone uses (`api/services/`), their tests, and the tables it alone reads or
  writes (listed only; tables are **not** touched in this task: dropping one is the owner's decision).
- Send the list to Claude's mailbox and wait for the reply before step 2. Expect some keepers: procedures used by the
  operations scheduler, the worker ingest route, health checks and the sign-in flow.

## Step 2 — removal (after Claude's reply)

Remove only the procedures and code Claude confirmed, with their tests. Never touch `api/lib/`, `api/kimi/`, `.env`,
infrastructure scripts or credential files. No schema change. Gates: `npm run check`, `npm test -- --run`, `npm run build`,
`git diff --check`. Write to Claude's mailbox before the full run and before asking for the web-server restart (Claude
restarts it). Then check that the desk's pages load (Claude's screenshot script, `scratchpad news/shot.mts`, or the
desk tests) and that every procedure the desk calls answers 401 without a session, not 404.

## Delivery

A report at the end of this file (removed, kept and why, tables listed for the owner), a handoff section and a mailbox
message.
