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

- **Owner-only procedures open to any member:** fixed in K17a. `browse.*` and the two Lab procedures are owner-only, `/admin` is guarded, and 47 owner procedures have guard tests.
  - `jobs.logs` still reads any job's log by id. K17a.1 limits members to their own jobs.
- **Messages privacy:** fixed in K17a with Claude's default, pending the owner's word:
  - a member sees the owner and admins, plus the people they already have a thread with;
  - the "admins can read threads" claim is gone;
  - reading other users' threads is not added unless the owner asks for it.
- **Owner reports readable by reviewers:** `/reports/*` admits any reviewer who accepted the NDA, including the daily operations, weekly coverage and data-health reports. K17b adds an owner level to the report whitelist.
- **A false CRITICAL every day:** the macro lineage checks compare run times, and the macro QA re-runs at 05:55, after the night chain built the derived reports. K17b makes the check compare input content.
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
- **Holders from K16:** the top holders, breadth (funds opening and closing positions, from K16.4), and the share of the company held.
- **Replay for any company:** pick a company and a date, and see the readings known then and what followed. The evidence ledger's rule applies: sealed decisions stay sealed.
- **Owner command palette actions:** run a job, open its log, restart a job chain, all from Ctrl+K, owner only.
- **Reviewer access with an end date and an audit log:** who saw what, when.
- **Password reset and invitations,** with no browser prompts.
- **Intraday views** (owner's yes, 2026-11-13: "wanted for the page look alive, did not plan to store all of it"): K21
  (`docs/engine/tasks/K21-intraday-candles-and-views.md`).
  - [x] The existing price snapshots move from every 20 to every 5 minutes; compact snapshots stay each time, raw responses only at the 20-minute marks, and sessions accumulate on D: with no pruning; the desk reads at most five.
  - [x] `desk.intraday` returns company/SPY/sector bars, cumulative VWAP, previous close, opening gap, release/8-K markers and split-rebased earlier sessions. `desk.intradayMarket` serves the shared summary.
  - [x] `desk-snapshot-live` also builds breadth, SPY/equal weight, sector funds, movers and per-company paths from the latest session bars, including after official closes.
  - [x] Views, reworked on 2026-11-15 after the owner rejected the first version ("added extra view, not functionality"):
    - The Company page has no separate intraday card. **1D and 5D are ranges of the existing Price chart**, drawn from the 5-minute bars, with the previous close as a dashed line on 1D and one label per session on 5D.
    - The Markets page has no "Through the day" card. The desk snapshot itself refetches every 5 minutes while a session is live and the page is visible, so the map, the movers and the header move during the day.
    - The Watchlist and Today day lines stay, with short labels.
    - `desk.intradayMarket` still feeds those day lines; the Markets page no longer reads it.
  - Highs and lows are explicitly approximate; raw responses are not collected at the intermediate five-minute slots. Intraday history for research, if ever needed, comes from the owner's Stooq 5-minute download, not this display archive.
  - Scheduler and web restarts belong to Claude's review/delivery step, not the implementation work block.
- **How members could find each other** (owner, 2026-11-13: "good plan, write it down, right now no need for it").
  Today a member sees only the owner, the admins and people they already wrote to. Steps, simplest first:
  1. **Owner introductions:**
     - the owner picks two members in the desk and introduces them;
     - this opens a thread between them with the owner's note;
     - no new data needed.
  2. **Contact requests by exact username:**
     - a member enters a username they got from that person (no browsing);
     - the other side accepts or declines, and only accepted pairs can write;
     - limits on pending requests per member, plus a block switch.
  3. **Opt-in directory** (once there are more members): members who turn on "visible to members" show a display name,
     a short bio and the sectors they follow. Contact goes through requests.
  4. **Company or topic rooms,** as an alternative to direct messages: one discussion per company or topic, visible to
     members and moderated by the owner. People meet there and move to direct messages through requests.
  - Steps 2–4 need new tables in `alpha_engine` (requests, profile visibility, rooms): a schema change for the owner's
    approval. Step 1 needs none.

## 5. Phases

1. **K17a — Messages and owner tools in the desk** (`fcd1494`; accepted by Claude on 2026-11-13, web server restarted 21:40Z).
   - Follow-up K17a.1:
     - `jobs.logs` limited to the member's own jobs;
     - the unrouted classic `pages/Admin.tsx` and `pages/Messages.tsx` removed;
     - FORBIDDEN instead of NOT_FOUND for members who name a missing account;
     - desk dialogs instead of `window.confirm`.
   - [x] Server-side guards and member-safe contacts, with recipient checks on both message reads and sends.
   - [x] `/desk/messages`: unread-first conversations, thread and composer; member-safe contacts, owner accounts and user intel. No cross-user thread reading was added.
   - [x] `/desk/admin`: People, Reviewers, Manuals, Logs and Monitors. People includes a one-time generated-password dialog and view-as return to the tab.
   - [x] Classic `/messages` and `/admin` redirect to the desk; the classic `/admin` route also has an owner guard.
   - [x] Operations and Library link to the new desk destinations. The unread dot and count link to `/desk/messages`; polling stops while hidden.
   - Dropped: the temporary price-archive upload card, the misleading "admins can read threads" footer claim, `AuthLayout.tsx`, `AuthLayoutSkeleton.tsx`, unrouted `Home.tsx`, and the reviewer guide's `/fundflows` entry.
   - Retained: worker-note detail with its SEC source, user intel, full reviewer reset actions, all four manuals (rendered as documents), job logs, factor IC and worker intake. Literal reviewer IPs are not exposed; only the binding state is available.
2. **K17b — Operations console** (spec `docs/engine/tasks/K17b-desk-operations-console.md`):
   - Server: owner-only reports, and the honest macro lineage status.
   - Desk Operations tabs: Health, Jobs (switch, cron edit with preview, Run and Stop with confirmation), Runs and logs, Coverage, Reference.
   - Classic `/workers` and `/jobs` redirect. The job launcher goes: the `jobs` table holds only five `universe-add` rows, the last on 2026-11-05.
3. **K17c — Company, Screener and Markets on the standard data:** statements, documents, holders, corporate actions; Terminal's charts. Also from phase 2:
   - the Watchlist takes "add any SEC company" and hide from `/universe`;
   - `/dashboard` retires.
4. **K17d — Research pages:** guidance, scenario lab, insider detail, options chain and features, tone and hypothesis ledger, handbooks.
5. **K17e — Retire the classic view:** redirects for every classic route, desk sign-in, password reset and invitations, then remove classic pages.
6. **Add-ons on the owner's word:** alerts centre, Telegram.

## 6. Claude's to-do (kept current)

- [x] Inventory the classic views (2026-11-13).
- [x] This plan.
- [x] Owner's answers, 2026-11-13 afternoon:
  - the messages privacy default stays ("confirmed, no change for now");
  - Telegram "not now";
  - the plan for finding other members is written down (section 4), not needed now;
  - intraday views yes (K21).
- [x] Write K17a after K16 is accepted. Include the guard list, the messages rules and the redirects.
- [x] Review K17a; the follow-up K17a.1 was sent (2026-11-13).
- [x] Check which classic job types still run. The local `jobs` table holds only five `universe-add` rows (last 2026-11-05); harvest, series build, section parse and scoring have no runs.
- [x] Write K17b (2026-11-13).
- [x] 2026-11-22, owner: "lets continue with old functionality rebuild and move to new platform". Kimi's credits end on
  2026-11-30; Claude builds, and K17b stays ready for Kimi if the owner starts it.
- **Order from here** (classic pages stay untouched until their replacement is in the desk; then they redirect and are
  removed together with the pipelines behind them):
  1. Company page, piece by piece on the standard data (below).
  2. Operations console (K17b). **Built 2026-11-23 (handoff 225):** tabs Health, Jobs, Runs, Coverage, Reference;
     `/workers` redirects and the classic page is removed. Open from K17b: its server part (task note K24, waiting
     for the owner's word) and `/jobs`, which stays until the Watchlist takes "add any SEC company".
  3. Research pages on the standards: guidance record (g1.2), insiders (i1.1), option chains, scenario lab, handbooks.
  4. Retire the classic view, then prune the old pipelines listed in `docs/PROJECT_REVIEW_2026-11-22.md` section 6.4.
- **How the desk reads the standards:** a builder turns a standard's own files on D: into compact per-company files
  under `worker/.runs/desk-company/`, and a desk procedure serves them. The research database is never read at request
  time, and the app database gets no new tables.
- **Company page on the standard data:**
  - [x] Financial statements (2026-11-22, `82491c7`): 20 quarters of income, balance sheet and cash flow lines from the
    standard fundamentals v3.1, as first reported; hover shows the filing date and XBRL tag; a later different figure
    is marked. Builder `scripts/build-desk-company.mts` (manual job `desk-company-statements`), 500 companies.
  - [x] Annual and trailing-year views; a chart per line (2026-11-22). 40 quarters; a fiscal year or trailing year is
    four consecutive quarters as known at the last one's report; share counts and per-share lines on today's share
    basis; figures out of scale are named, not shown. Checked against the filed annual facts by
    `scripts/check-desk-company-years.mts` (handoff 213).
  - [x] Splits, dividends and other distributions from the standard prices (2026-11-22, `c958388`), for every member.
  - [x] Holders and breadth from the 13F standard k16.5; insiders from the insider standard i1.1 (2026-11-22). The
    desk page no longer reads the classic 13F summary (`company.institutional`, the stored table with half the money
    missing) or the Form 4 table (`company.insiderTrades`). The short-interest lines still come from the app.
  - [x] Terminal's three charts (2026-11-22): a "Risk and returns" card under the price chart, from the closes of the
    chosen range: the period's figures, the fall from the high, the spread of daily returns.
  - [x] Filings list and a reader for the earnings releases (2026-11-22): five years of 10-K, 10-Q and 8-K filings
    from the release calendar, each linked to the SEC's copy; an earnings release opens as plain text from the cached
    exhibit. The classic documents tab (the app's `documents` table, 51 companies) is not used by the desk.
  - [x] Guidance history (2026-11-22, `c958388`): each guided quarter and fiscal year from the guidance standard g1.2 final,
    release after release, beside the figure first filed; owner and NDA reviewers only. 349 companies have guidance.
  - [x] Adjusted (non-GAAP) earnings (2026-11-23, handoffs 217, 218 and 224): read from the releases'
    reconciliation tables by `scripts/build-adjusted-eps.mts`, on the page from reader a8 (a2 until handoff 224; a3 to
    a7 were read in full and not used). 1,002 of 1,793 adjusted quarterly guidance periods and 317 of 1,482 fiscal
    years on the page have the reported figure. Fiscal years are still read through the headers only, and must agree
    with the sum of their quarters.
    Background: the figure was **not in any data we had** (checked 2026-11-22, handoff 215): the K12.1 release tables hold GAAP lines only (34 adjusted
    per-share rows in 31,258 releases; the K12 spec left non-GAAP out), and the guidance standard has a reported
    adjusted figure for 259 of 9,722 adjusted-guided periods. It needs a new reading of the releases'
    reconciliation tables (a parser task, or a local-model pass), or a vendor's reported earnings. Owner's call.
  - [x] Owner, 2026-11-22 ("agree"): the valuation, probability and sentiment panels of the classic company page are
    left out of the desk. They come from the app's old factor engine, which never passed an out-of-sample test.
- [ ] Design notes per phase: page sketches, data each view reads, DevNotes text.
- [ ] Keep this file current after each phase: what moved, what was dropped and why.

## 7. Status on 2026-11-23 (evening): what has moved, what has not

Checked against the code: the routes in `src/App.tsx` and `src/desk/DeskApp.tsx`, and the server procedures each side
calls. 18 classic routes are still live; only `/messages` and `/admin` redirect to the desk.

### 7.1 Pages

| Classic page | In the desk | Not moved yet |
|---|---|---|
| Messages, Admin | **Moved** (`/desk/messages`, `/desk/admin`); classic routes redirect | — |
| Company `/company/:ticker` | **Mostly moved, on the standards:** statements (v3.2, quarter, year, trailing year, a chart per line), guidance and the reported figure (g1.2, adjusted EPS), splits and dividends, holders (13F k16.6), insiders (i1.1), short interest, filings with a release reader (500 companies instead of the old documents tab's 51), risk and returns (Terminal's charts), price, options, peers, reactions | Any-concept series explorer, data-health tab, signal stream, LLM briefs. **Dropped by the owner (2026-11-22):** valuation, probability, factor IC and sentiment panels |
| Terminal | Its three charts (Risk and returns card) | The route stays live and is still the landing page for users who chose the classic view |
| Dashboard | Today (filings, FRED values, watchlist, coming up, just reported); Flows and Ownership for sector flows | Morning brief (paused by the owner); launch buttons (go to Operations) |
| Screener | **Moved** (handoff 226): two views. Performance: price, returns, 12−1 momentum, market value, beta, volatility, 52-week range, trend, next report. Fundamentals, from the standard fundamentals and prices: P/E, diluted EPS, revenue and its growth, net margin, FCF margin (last four reported quarters), three-month dollar volume; yield and market value are Schwab's | Revision rate (belongs to the guidance record); "sentiment (prototype)" is dropped. Market value and yield from our own data wait for share counts of multi-class companies and for the dividend gaps in the standard prices |
| Universe | Watchlist follows and unfollows index companies | Add any SEC company (starts an ingest), hide, scope presets, GICS re-enrichment, S&P bootstrap |
| Workers | **Moved** (handoff 225): Operations → Jobs (switch, schedule edit with the next runs, Run and Stop after a confirmation that names the chain), Runs (running, waiting, last run of each job, logs), Coverage, Reference (what follows what); `/workers` redirects, the classic page is removed | Owner-only reports and the honest macro status on the server (K24) |
| Jobs | — | The classic `/jobs` page stays until the Watchlist can add a company (its only use: five `universe-add` rows) |
| Expectations | Each company's guidance history on its page (g1.2 final) | The cross-company record with quotes and revisions; the classic page still bundles the old 27 MB report |
| Insider activity | Ownership, on the insider standard i1.1 for all 500 companies (handoff 225): 90-day totals, open-market purchases, windows with several insiders buying, the companies with the largest net selling and buying; insiders card per company | Full Form 4 list with the excluded codes and filters |
| Scenario Lab | Macro: rate and credit exposure ranking | Custom shocks, presets, evidence inspector, export |
| Market data | Volatility (features, implied against realized, sizing); Operations (capture health) | Option chain browser, provenance |
| Analytics | Signals ledger | Tone reaction chart; build network (to Operations) |
| Methodology handbook, Wiki | Linked from Library | As documents in Library, with LaTeX rendered |
| Database browser | — | Owner "raw facts" explorer in Operations |
| Risk lab, Lab, Project state | — | To be dropped (section 2) |
| Login, Signup | — | Desk sign-in, password reset, invitations (K17e) |

New in the desk, no classic page: Markets, Flows (hall and reading view), Engine (engine v1, traced), Earnings and
Volatility research, the intraday ranges.

### 7.2 Logic and algorithms

- **Fixed 2026-11-23 (handoff 223):** the Signals ledger is set against the research record again (15 families: one
  candidate, the low share of short sales; two risk measures; eleven with nothing beyond noise; the foresight ceiling
  as the yardstick) and shows the day it was reviewed. What was wrong: the ledger (`src/desk/evidence.ts`, last
  changed 2026-11-11) predated the decisive test of 2026-11-12. The release-reaction effect did not repeat on 440 other companies, and engine v1 has no edge on
  the S&P 500, but both still read "candidate". Later results are missing: guidance g1.2 reruns (every verdict
  unchanged), the pooled engine and its ceilings, the miss forecaster ("the predictable part of the beat is priced"),
  technical sensing, short interest, insiders.
- **Fixed 2026-11-23 (handoff 223):** the research Ownership page's sector table and headline figures read the fund
  books behind Flows (`desk.flowsOverview`), no longer the app's `fund_holdings` table, which keeps half the money
  (one row per security); the dry-run insider benchmark is gone from the page. **Fixed 2026-11-23 (handoff 225):** its insider cards
  read `insiders-market.json`, which the company-page builder writes from the insider standard i1.1 for all 500
  companies (`desk.insiderMarket`); the old Form 4 export of the 50 research companies is no longer read by the desk.
- **The app's old factor engine** (`company.factors`, `company.probability`, `company.value`; nightly
  `research-series` and `research-factors`) is not moved, by the owner's decision: it never passed an out-of-sample
  test. Only its factor-IC monitor sits in Owner tools → Monitors. The nightly jobs still run, and the classic company
  page still shows its output as if it were a signal.
- **Lab work without a view:** the per-company and pooled engines, the nowcasts, the ceilings, the miss forecaster. The
  Engine page shows engine v1 only.
- **Moved as displays:** first-session reaction and drift (Earnings), implied and realized volatility with the sizing
  calculator (Volatility), rate and credit exposure (Macro), corporate actions and the split watch (company page), the
  adjusted-earnings reader (company page, a8).
- **Not moved:** sentiment and tone scoring, LLM digests and the morning brief (Ollama stopped on the owner's word;
  tone measured nothing at the release).

### 7.3 Suggested order

1. ~~Correct the Signals ledger from the research record.~~ Done.
2. ~~Ownership's sector flows from the 13F standard; its insider cards from the insider standard.~~ Done.
3. ~~Operations console (K17b).~~ Done; `/workers` is retired, `/jobs` follows with the Watchlist's "add a company".
4. ~~Screener columns from the standard fundamentals.~~ Done (handoff 226). Open: Watchlist "add any SEC company".
5. Research pages: the cross-company guidance record (g1.2), the full insider list (i1.1), option chains, the scenario
   lab, handbooks and wiki as documents.
6. Retire the classic view: redirects, desk sign-in; then the old pipelines (`docs/PROJECT_REVIEW_2026-11-22.md`
   section 6.4).
