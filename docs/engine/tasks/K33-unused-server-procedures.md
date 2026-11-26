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


## Step 1 delivery — Kimi, 2026-11-26

Runtime enumeration of `appRouter._def.procedures` found **79 tRPC procedures**. Direct call-site search covered
`src/desk`, the remaining `src/`, workers, scripts and tests. **78 have current `src/` callers; none is tests-only;
`ping` alone has no caller.** Every procedure is listed below with its live caller group.

### tRPC inventory

- **activity (1):** `track` — `src/desk/DeskShell.tsx`.
- **admin (15):** `manuals`, `manualContent` — admin/Manuals; `recentJobs`, `jobLog` — admin/Logs; `reviewerList`,
  `createReviewer`, `resetReviewerFirstIp`, `resetReviewerNda` — admin/Reviewers; `usersList`, `createUser`,
  `deleteUser`, `setUserRole`, `resetPassword` — admin/People (`deleteUser` also Reviewers, `usersList` also DeskShell
  view-as); `userSummary`, `userActivity` — Messages.
- **auth (12):** `me`, `logout` — `src/hooks/useAuth.ts`; `captcha`, `signupOpen`, `login`, `signup` — SignIn;
  `security`, `secondFactorBegin`, `secondFactorEnable`, `secondFactorDisable`, `revokeSession`,
  `revokeOtherSessions` — Security.
- **company (1):** `shortInterest` — Company.
- **dashboard (2):** `latestFilings` — Today; `macro` — Today and research/Macro.
- **universe (3):** `list`, `add`, `remove` — `src/desk/data.ts`.
- **prices (1):** `history` — Company.
- **messages (5):** `contacts`, `list`, `markRead`, `send` — Messages; `unreadCount` — DeskShell.
- **reviewer (3):** `status`, `acceptNda`, `tourAction` — `src/hooks/useReviewer.ts`.
- **workersLocal (6):** `enabled`, `operations`, `setOperation`, `runOperation`, `killOperation` — Operations;
  `operationLog` — operations/Runs.
- **workersMonitor (1):** `intake` — admin/Monitors.
- **desk (28):** `snapshot`, `opsHealth` — data/DeskShell; `intraday`, `intradayMarket` — intraday;
  `flowsOverview`, `flowsFund`, `flowsCompany`, `flowsInsiders`, `flowsActivists` — flows/data and Holders;
  `companyStatements`, `companyActions`, `companyHolders`, `companyInsiders`, `companyFilings`, `companyDocument`,
  `companyGuidance`, `companyOptionChain`, `companyNews`, `companyBrief` — the corresponding company pages;
  `briefs` — Today; `engineIndex`, `engineCompany` — EnginePage; `news` — News; `guidanceMarket` — research/Guidance;
  `insiderMarket` — research/Ownership; `screen` — Screener; `securityEvents`, `sourceFreshness` — Operations.
- **ping (1):** no source, worker, script or test caller. Inline in `api/router.ts`; no service, dedicated test or table.

### Raw routes in `api/boot.ts`

- `GET /robots.txt` — no repository caller; robots convention, keep.
- `GET Paths.oauthCallback` (`/api/oauth/callback`) — external OAuth provider/sign-in flow and perimeter test, keep.
- `POST /api/prices-import/chunk` — **no current caller**, historical manual only; candidate for Claude review.
- `GET /api/prices-import/parts` — **no current caller**, historical manual only; candidate for Claude review.
- `POST /api/worker/ingest` — facts-fetch, Stocktwits, scheduler local ingest and prod-push helpers, keep.
- `POST /api/worker/backup-expectations` — `scripts/lib/worker-expectations-api.ts` and tests, keep.
- `POST /api/worker/apply-expectations-reviewed` — the same reviewed manual flow, keep.
- `GET /reports/:name` — current desk report reads/links and report/reviewer tests, keep.
- `ALL /api/*` is the intentional JSON 404 fallback, not a removable business endpoint; `/api/trpc/*` dispatches the 79
  procedures above.

### Unused-route dependencies (listing only)

`ping`: no service, test or table; removal candidate is only its inline procedure.

The two price-import routes call `handleChunkUpload`/`handleListParts` in `api/services/price-import.ts`. **No service or
DB table is exclusive to those handlers.** `price-import.ts` also contains `importPricesFromStorage`, still called by
`api/services/runner.ts` for `type="prices", mode="import"`; it must not be removed with the route wrappers. The runner
path reads `userUniverse` and writes `prices` through shared `upsertBars`; those are not route-exclusive tables. Session
authentication reads/writes shared `userSessions`. Object-storage prefix `prices-import/` is not a DB table and is not
touched.

Associated tests: `api/services/price-import.test.ts` tests pure parser/mapping/part-key helpers, not the HTTP handlers;
`api/services/perimeter.test.ts` explicitly covers the chunk route's proxy refusal. There is no direct handler test.
No procedure, route, service, test, storage object or table was removed or modified in step 1. Waiting for Claude's reply
before step 2.
