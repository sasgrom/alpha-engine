# Moving the classic UI into the desk — plan, notes and to-do

**Owner's order of 2026-11-13** (backburner, done in spare time): "continue with old UI functionality to be transfered to
your new design … messages (maybe we should implement telegram api for the messages outside the universe, not a 100%
requirement, maybe add-on feature?), owner tools etc that lead to the old views, re-design in new way, remove
unnecessary info and functionality add new functionality, lets make complete move on all the valuable info and view to
new design. keep making notes, improvement ideas … plan, write todo for yourself and execute".
Also: "dont forget that kimi is here to help you … delegate!"

**Who does what:**
- Claude: this plan, the design of each view, the task specs and the reviews.
- Kimi: the builds, one spec at a time (K17a, K17b …), after K16.

Inventory source: a read-only sweep of every classic page on 2026-11-13. Its findings are folded in below.

## 1. Principles (the owner's earlier directions still hold)

- The desk (`src/desk/**`, `/desk/*`) is the product. The classic view stays reachable only until each part has moved; then its route redirects to the desk.
- **No development artifacts:** no stage labels, no "prototype" tags, no raw JSON dumps, no machine paths, no debug switches.
- **"The platform needs to extract alpha, every bit of it":**
  - every view earns its place by helping find or test an edge;
  - research readings go through the evidence ledger (`src/desk/evidence.ts`);
  - an untested reading is never shown as a signal.
- Every desk page ends with its `DevNotes` (owner only): what is missing, and what could be better but we are short of.
- **Access is enforced on the server.** A UI guard only hides; every owner tool's procedures check the role.
- Never call `dashboard.stats` from the desk. Load heavy data lazily, never bundle it.
- Light and dark validated, one token set (`src/desk/desk.css`), phone width works.

## 2. Inventory → destination

| Classic view | Keep, merge or drop | Desk destination | Phase |
|---|---|---|---|
| Messages (`/messages`): threads, composer, contacts, unread badge, the owner's "user intel" | **Keep, redesign** | `/desk/messages` + the shell's unread dot (exists) | 1 |
| Admin (`/admin`): users and roles, view-as, password reset; reviewers (NDA, IP binding, tours); manuals; job logs; tools | **Keep, redesign** | `/desk/admin`, owner only: People, Reviewers, Manuals, Logs | 1 |
| Workers (`/workers`): scheduler switches, cron edit, run, stop, logs, weekly coverage, run stack, runbook | **Merge** | Desk Operations becomes the console: health (exists) + jobs and schedules + logs + coverage | 2 |
| Jobs (`/jobs`): launcher for 8 job types, queue, cancel, live logs; the job-completion watcher | **Merge what is still used** | Operations → "Runs". Keep ingest, filing refresh, prices; check whether harvest, series build, section parse and sentiment scoring still run before moving them | 2 |
| Dashboard (`/dashboard`): counters, sector flows, LLM morning brief, FRED tiles, latest filings, recent jobs, launch buttons | **Mostly covered** | Today already has filings and macro; Flows/Ownership cover sector flows; morning brief → Today (if kept); launch buttons → Operations; counters dropped | 2 |
| Universe (`/universe`): table, hide switch, add non-index company (ingest), scope presets, GICS re-enrichment, S&P bootstrap | **Merge** | Watchlist gains "add any SEC company" and hide; presets and admin actions → Operations | 2 |
| Company (`/company/:ticker`): statements, series explorer, documents reader, valuation/probability/IC, sentiment, signal stream, LLM briefs, data health, insiders, 13F, short interest | **Keep the evidence, rebuild on the standard data** | Desk Company: Statements from the standard fundamentals (v3.1), Documents, Data health, Holders (K16 tables), Corporate actions (std_prices). The old factor/probability tabs only where the evidence ledger backs them | 3 |
| Screener (`/screener`): extra columns (EPS TTM, FCF margin, 3-month volume, revision rate, sentiment), rebuild | **Merge columns that carry evidence** | Desk Screener: add EPS, FCF margin, volume from the standard tables; drop "sentiment (prototype)" until tested | 3 |
| Terminal (`/terminal`): a third design | **Drop as a view** | Its drawdown chart, return histogram and period statistics move to desk Company and Markets; `/terminal` redirects | 3 |
| Expectations (`/expectations`): guidance record with quotes and SEC links; QA tabs | **Keep the record, drop the QA tabs** | Desk Earnings → "Guidance", lazy-loaded from a report file (not the 27 MB bundle) | 4 |
| Scenario Lab (`/scenario-lab`): custom shocks, presets, impact table, evidence inspector, export | **Merge** | Desk Macro: custom shocks + per-company evidence | 4 |
| Insider activity (`/insider-activity`): excluded rows, ticker filter, clusters, dry-run benchmark | **Merge** | Desk Ownership: filter, excluded rows, full list; drop the "preview sample" banner | 4 |
| Market data (`/market-data`): options chain browser, Feature Lab, Market Context, provenance | **Merge** | Desk Volatility: chain browser and features; provenance → Operations | 4 |
| Analytics (`/analytics`): build-status network, tone CAR chart, hypothesis ledger, weekly history | **Merge** | Desk Research/Signals: tone CAR chart and hypothesis ledger; the build network → Operations | 4 |
| Methodology (`/analytics/methodology`): volatility handbook | **Keep as a document** | Desk Library → "Handbooks", with LaTeX rendered (now shows raw `\(P_t\)`) | 4 |
| Wiki (`/wiki`): factor encyclopedia | **Keep as a document** | Desk Library → "Factors" | 4 |
| Database (`/database`): filings browser, raw us-gaap explorer | **Merge** | Desk Company Documents + an owner "Raw facts" explorer in Operations | 4 |
| Risk lab (`/analytics/risk-lab`): one AAPL replay, one date | **Drop** | Desk Volatility's sizing covers today's use; a replay for any company is an idea below | — |
| Lab (`/lab`): sentiment scoring coverage, static text | **Drop** | Scoring coverage → one line in Operations if scoring still runs | — |
| Project state (`/project-state`): static status story with stale figures | **Drop** | Live status lives in Operations and the Engine page | — |
| Login, Signup | **Keep, re-skin** | Desk sign-in; add password reset and invitations (new) | 5 |
| Dead code: `AuthLayout.tsx`, `AuthLayoutSkeleton.tsx`, `pages/Home.tsx`, the reviewer guide's `/fundflows` | **Remove** | — | 1 |

## 3. Fix on the way (found by the inventory; each goes into the phase that touches it)

- **Owner-only procedures open to any member:**
  - `browse.*` (Database) and `sentiment.labStats` / `tickersWithScores` (Lab) are `authedQuery`; only the UI hides them.
  - `/admin` is not wrapped by the guard in `App.tsx`.
  - Phase 1 moves every owner tool behind server-side role checks.
- **Messages privacy:**
  - The contact list shows every account, with its role and last activity, to every member.
  - The footer claims admins can read threads, but nothing implements that.
  - Proposal (Claude's default unless the owner decides otherwise):
    - a member sees the owner and admins, plus the people they already have a thread with;
    - the claim goes;
    - reading other users' threads is not added unless the owner asks for it.
- **Heavy loads:**
  - The classic layout polls `dashboard.stats` every 5 s.
  - Expectations bundles about 27 MB into the app.
  - Both disappear with the move.
- **Text:** stage labels, "(prototype)", "temporary crutch… TODO", machine paths in error states, raw LaTeX.

## 4. New functionality (ideas; each needs a spec and, where noted, the owner's word)

- **Alerts centre** in the desk shell, one inbox for job failures, scheduler alerts, data-health checks, upcoming splits of our companies (the daily split calendar) and new messages, with read state.
- **Telegram add-on** (owner: "not a 100% requirement, maybe add-on feature").
  - **First version:** outbound only. The owner's chosen alerts and new-message notices go to his Telegram through a bot.
  - **Then two-way:** a reply in Telegram lands in the desk thread.
  - **"Outside the universe":** people who are not platform members could reach the owner through the bot, into a separate "outside" inbox.
  - **Needs:** the owner's decision (a new external service, AGENTS.md section 6); a bot he creates himself (BotFather), with the token in `.env` by his hand; no message content in logs.
- **Corporate actions on the company page:** splits, dividends and spin-offs from `std_prices`, with as-traded and adjusted price.
- **Standard statements:** the company page reads the standard fundamentals (v3.1). Each value has a hover with its filing, tag and filed date, so a reader can trace every number.
- **Holders from K16:** the top holders, new and exited funds, and the share of the company held.
- **Replay for any company:** pick a company and a date, and see the readings known then and what followed. The evidence ledger's rule applies: sealed decisions stay sealed.
- **Owner command palette actions:** run a job, open its log, restart a job chain, all from Ctrl+K, owner only.
- **Reviewer access with an end date and an audit log:** who saw what, when.
- **Password reset and invitations,** with no browser prompts.

## 5. Phases

1. **K17a — Messages and owner tools in the desk** (implemented; Claude review and web restart pending).
   - [x] Server-side guards and member-safe contacts, with recipient checks on both message reads and sends.
   - [x] `/desk/messages`: unread-first conversations, thread and composer; member-safe contacts, owner accounts and user intel. No cross-user thread reading was added.
   - [x] `/desk/admin`: People, Reviewers, Manuals, Logs and Monitors. People includes a one-time generated-password dialog and view-as return to the tab.
   - [x] Classic `/messages` and `/admin` redirect to the desk; the classic `/admin` route also has an owner guard.
   - [x] Operations and Library link to the new desk destinations. The unread dot and count link to `/desk/messages`; polling stops while hidden.
   - Dropped: the temporary price-archive upload card, the misleading "admins can read threads" footer claim, `AuthLayout.tsx`, `AuthLayoutSkeleton.tsx`, unrouted `Home.tsx`, and the reviewer guide's `/fundflows` entry.
   - Retained: worker-note detail with its SEC source, user intel, full reviewer reset actions, all four manuals (rendered as documents), job logs, factor IC and worker intake. Literal reviewer IPs are not exposed; only the binding state is available.
2. **K17b — Operations console:** scheduler controls, runs and logs, coverage, the useful job launchers, ingest of any SEC company.
3. **K17c — Company, Screener and Markets on the standard data:** statements, documents, holders, corporate actions; Terminal's charts.
4. **K17d — Research pages:** guidance, scenario lab, insider detail, options chain and features, tone and hypothesis ledger, handbooks.
5. **K17e — Retire the classic view:** redirects for every classic route, desk sign-in, password reset and invitations, then remove classic pages.
6. **Add-ons on the owner's word:** alerts centre, Telegram.

## 6. Claude's to-do (kept current)

- [x] Inventory the classic views (2026-11-13).
- [x] This plan.
- [ ] Ask the owner, in the morning report:
  - the messages privacy default;
  - Telegram yes or no (and which alerts);
  - whether the old job types (harvest, series build, section parse, sentiment scoring) still matter.
- [x] Write K17a after K16 is accepted. Include the guard list, the messages rules and the redirects.
- [ ] Check which classic job types still run (jobs table, last runs) before K17b.
- [ ] Design notes per phase: page sketches, data each view reads, DevNotes text.
- [ ] Keep this file current after each phase: what moved, what was dropped and why.
