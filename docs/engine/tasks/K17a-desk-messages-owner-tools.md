# K17a — Messages and owner tools in the desk (UI move, phase 1)

**Owner's order of 2026-11-13** (backburner, Claude plans, Kimi builds): "continue with old UI functionality to be
transfered to your new design … messages …, owner tools etc that lead to the old views, re-design in new way, remove
unnecessary info and functionality add new functionality" and "dont forget that kimi is here to help you … delegate!".
**Plan:** `docs/desk/UI_MIGRATION.md`, phase 1. **Author:** Claude. **Coder:** Kimi. **LLM use:** none.

## 1. Server-side access first

A UI guard only hides; procedures must check the role. Use `adminQuery` (`api/middleware.ts`).
- `browse.*` (in `api/routers/engine.ts`), `sentiment.labStats` and `sentiment.tickersWithScores` become owner-only
  (`adminQuery`). Check every other procedure the classic owner pages call (`/database`, `/lab`, `/admin`, `/workers`,
  the Jobs launcher) and list each with its guard in the delivery; change any that is an owner tool but open to members.
- The `/admin` route is wrapped like the other owner pages.
- Tests: a member calling each owner procedure gets FORBIDDEN; the owner succeeds.

## 2. Messages in the desk: `/desk/messages`

Redesigned, not ported:
- A conversation list (unread first, then latest), the thread, and a composer. 2,000 characters, as now.
- **Contacts:**
  - A member sees the owner and admins, plus the people they already have a thread with.
  - The owner sees every account and the user-intel panel (`admin.userSummary`, `admin.userActivity`), which moves here.
  - Members no longer see the full account list, roles or last activity.
- **The footer claim** "admins can read threads" is removed. Reading other users' threads is **not** added; the owner may ask for it later.
- **Reviewers** stay as now: no messages in the desk; the server already refuses their sends.
- **Unread:** the desk shell's dot and the "N new" link go to `/desk/messages`. Polling stays modest: 30 s in the shell, 8 s on the page while it is visible, none when the tab is hidden.
- **Server changes:** `messages.contacts` applies the member rule; `list` and `send` refuse a recipient outside the
  caller's allowed contacts (a member may always write to the owner and admins). Tests for both.
- The classic `/messages` route redirects to `/desk/messages`.

## 3. Owner tools in the desk: `/desk/admin` (owner only)

Tabs:
- **People:** list, create (role user or admin), promote/demote, delete, reset password, view-as.
  - The admin's own row stays protected.
  - Reset password uses a dialog that shows a generated password once, not a browser prompt.
  - View-as keeps the existing read-only semantics; exiting returns to `/desk/admin`.
- **Reviewers:** create (NDA, IP binding, tours, 50-company universe); per reviewer reset IP+NDA, reset NDA, reset tour, delete. Show the NDA acceptance date and the bound IP.
- **Manuals:** the four manuals rendered as documents (headings, tables, code), not raw text.
- **Logs:** recent jobs and a job log viewer (`admin.recentJobs`, `admin.jobLog`).
- **Monitors:** the factor-IC monitor and the workers intake, as compact tables.

**Dropped:** the price-archive upload card. Its own text calls it a temporary crutch; Stooq dumps are loaded on the
home machine by script.

The classic `/admin` route redirects to `/desk/admin`. Desk Operations' owner tiles and the Library's Owner tools link to
the new tabs; `/workers`, `/database` and `/lab` stay classic until phases 2 and 4.

## 4. Clean-up

- Remove `src/components/AuthLayout.tsx`, `AuthLayoutSkeleton.tsx`, `src/pages/Home.tsx` (not routed), and the reviewer guide's `/fundflows` entry.
- New desk pages follow the desk's tokens and patterns (`src/desk/desk.css`, the shell, light and dark, phone width).
- Each ends with `DevNotes`: add the text in `src/desk/devnotes-data.ts`, covering what is missing and what could be better.
- No stage labels, no "prototype", no machine paths.

## 5. Rules

- Nothing in `api/lib/`, `api/kimi/`, `.env`; no schema change. If a column is truly needed, stop and ask Claude.
- No production write; no web restart (Claude restarts after review); no new external service. Telegram is a later add-on that needs the owner's word.
- English names, comments and test names.

## 6. Acceptance

1. Guard tests: every owner procedure refuses a member. The delivery lists every procedure with its guard.
2. Messages rule tests: contacts, refused recipients, owner view.
3. Desk page tests (jsdom, `src/desk/desk-test-harness.tsx`) for `/desk/messages` and each `/desk/admin` tab: render, empty state, one action each.
4. Redirect tests for `/messages` and `/admin`.
5. Gates: `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send Claude a note before the full test run.
6. One commit with code, tests, `docs/desk/UI_MIGRATION.md` updated (phase 1 done, what moved and what was dropped) and a handoff section. Fast-forward push when only your commit is ahead.
7. A mailbox message with the commit, the guard list, test counts and screenshots or descriptions of the new pages in light and dark.
