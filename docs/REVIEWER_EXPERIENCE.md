# Reviewer Experience — private academic presentation

## Purpose

Provide a read-only, guided presentation of Alpha Engine for an academic reviewer. The reviewer sees 50 presentation companies, NDA-gated research surfaces and two guided tours. No collector, scheduler, production mutation, model promotion or administrative operation is exposed.

## Access model

- `users.role` remains `user`; a separate `reviewer_access` profile prevents privilege drift.
- The first successful login binds the account to a one-way HMAC-SHA256 hash of the source IP. Subsequent logins are accepted only from the same network. The raw IP is not stored.
- The reviewer cannot add/remove universe entries, launch jobs, call collectors, access Operations, use the database browser or perform admin mutations. tRPC mutations outside NDA/tour/logout are rejected as read-only.
- `auth.me`, `auth.logout` and reviewer lifecycle endpoints remain available so the NDA can be displayed and completed. Other tRPC queries require an accepted NDA.

## NDA gate

The NDA is short and versioned (`2026-11-04`). Before acceptance, the React shell shows only the NDA dialog. Direct report URLs and tRPC content calls enforce the same gate.

Consent records:

- `userId`;
- `ndaVersion` and text SHA256;
- acceptance timestamp;
- accepted IP HMAC;
- accepted user agent;
- session union identity.

No raw IP or credential is written to the database or logs. Acceptance is idempotent: a second acceptance does not create a second consent row.

## Guided tours

Two server-persisted tracks are available after NDA acceptance:

1. **Geography** — Mission Control, review universe, company evidence, market data and Scenario Lab, research surfaces, Project State and reviewed-only delivery.
2. **Technical** — availability, first/latest vintages, FRED/ALFRED windows, factor IC, event studies and Atlas, options context, the pooled-model hypothesis and evidence boundaries.

Tour state (`not_started`, `in_progress`, `completed`, `dismissed_forever`) and current step are stored per user and track. “Skip for now” permits another suggestion later; “Never show again” is permanent unless explicitly restarted.

## Presentation security and limitations

- `/reports/*` requires admin or an NDA-accepted reviewer.
- tRPC content requires NDA acceptance. Other mutations remain read-only.
- Security headers include `X-Robots-Tag: noindex,nofollow,noarchive,nosnippet,noimageindex`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: private, no-store` for API/report routes.
- `/robots.txt` disallows crawling.

Copying, context menus, drag/copy shortcuts and printing are deterred for reviewer sessions, and a user-specific watermark is shown. **Browsers cannot technically prevent screenshots, DevTools extraction or determined scraping.** These controls are deterrents and access controls, not a guarantee against capture.

## Activation (owner only)

1. Apply the reviewed migration locally:

   ```powershell
   npx tsx apply-ddl-029.mts
   ```

2. Seed the reviewer account and the 50-company presentation universe with environment variables. Do not put credentials in Git, chat, scripts or logs:

   ```powershell
   $env:REVIEWER_USERNAME = "<reviewer-login>"
   $env:REVIEWER_PASSWORD = "<reviewer-password>"
   $env:REVIEWER_DISPLAY_NAME = "Dr. Larry Souza"
   npx tsx scripts/seed-reviewer-account.mts
   ```

   The seed refuses to reseed an existing account. Use the owner password-reset flow instead when required.

3. On the reviewer's first login, bind the original network. If the network changes legitimately, use an owner-reviewed reset of that binding rather than disabling the check.

## Owner administration

**Admin → Reviewer** provides the same account lifecycle locally and in the owner-controlled deployment:

- create a reviewer with an owner-provided username, password and optional display name;
- inspect NDA state, first-IP binding state, presentation-universe size and both tour states without exposing credentials or IP hashes;
- **Reset IP+NDA** clears the network binding and all NDA acceptance metadata, so the next login binds a new network and requires consent again;
- **Reset NDA** clears only consent metadata and preserves the existing first-IP binding;
- **Reset tour** returns both tracks to step 0 / `not_started` without changing NDA or network state;
- **Delete** removes the reviewer account and its per-user data, including reviewer access, tour preferences and universe memberships.

Creating a reviewer uses one transaction for the local `user` account, reviewer profile, two tour preferences and exactly 50 unique presentation-company memberships. The account keeps `users.role=user`; reviewer access never grants administrator privileges. API list responses omit password hashes, raw IPs and IP HMAC values.

## Verification

- NDA before/after acceptance, including direct tRPC and report access.
- First-IP binding and mismatch rejection.
- Read-only mutation rejection even after NDA acceptance.
- NDA idempotency and tour state transitions.
- Both tour tracks, step navigation, completion and permanent dismissal.
- Responsive NDA/tour layouts and reduced-motion behavior.
- Sequential DDL regression: **4/4 tests**; local migration/table/index checks and typed NDA/first-IP smoke passed in commit `53e4e82`.
- Reviewer administration service/UI and DDL targeted suite: **3 files / 9 tests**.
- Final integrated suite: **133 test files / 733 tests**, TypeScript and production build.

Local migration and one local reviewer account were created and smoked by Kimi Code as recorded in `docs/KIMI_CODE_HANDOFF.md` §42. Production migration, production account creation and production deployment were not performed by this change.
