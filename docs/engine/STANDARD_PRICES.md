# Standard prices — how the series are built, checked and kept

The owner's order of 2026-11-13: clean the other factor families the way the fundamentals were cleaned, prices first
("go with your recommendation"), corporate actions from every source we can get ("lets get it from whoever we can, then
recocile").

This document is the process. With it, the build can be repeated and the mistakes made on the way are not made again.

- **Code:** the lab repository `C:\dev\alpha-engine-lab\src\prices\`.
- **Data:** `D:\research\alpha-engine\prices\` (build `std\`).
- **Tables:** `alpha_research.std_prices`, `std_price_companies`, `std_price_builds` (AGENTS.md section 3.2).

## 1. What the series are

- **One row per company and trading session** inside its span (CIK keyed; the app's 517 companies and funds).
- **As traded:** the open, high, low, close and volume of that day, on that day's share basis. Nothing is adjusted, so
  a stored bar never changes when a later split comes: the table is point in time by construction.
- **The corporate actions taking effect that session:** the cash dividend going ex (per share, as traded), the split
  ratio (new shares per old share) and a distribution's factor (a spin-off or stock distribution: price before ÷ price
  after).
- **Two indexes computed from those:** `splitIndex` (shares held per share held at the first session) and `trIndex`
  (total return: dividends reinvested at the close, distributions at their factor; 1 at the first session).
  Today's-basis prices are `close × splitIndex ÷ splitIndex(today)`; returns are `trIndex` ratios.
- **`source`:** whose bar it is, `tiingo` or `schwab`. An empty bar means no vendor's bar is trusted that session; the
  events of that session still count (they are carried to the next bar in the indexes).
- **Calendar:** a date is a session when at least half of the companies whose app price history spans it have a bar.

## 2. Sources, and what each lacks

| Source | What it gives | What it lacks |
|---|---|---|
| The owner's Tiingo table (`F:\work\snp500.sql`, extracted by `tiingo-dump-extract.py`) | As-traded daily OHLCV of 493 tickers, 2000-01-03 → 2024-04-22, with `div_cash` and `split_factor` | Anything after 2024-04-22. Companies outside its 2021 list (FB/META, BALL, ELV, the later S&P members). Weekend and holiday rows are the owner's calendar-day fill, not quotes. A few tickers carry another company's dividend rows (CB 2010: the old Chubb Corporation's $0.37 next to ACE's $0.33). |
| Schwab price history (the app's `prices`, sources `schwab-hist` from 2006-11-10 and `schwab` after Stooq's last date) | Every company to today | It is on today's basis, adjusted by Schwab's own and inconsistent rules (section 4). It is keyed by the current symbol, so a renamed or reused ticker can carry another company's years (GEN before 2022, VICI before 2018, COR, JCI and CB before their mergers). Some histories miss adjustments (IDXX before 2007-11-27, RJF before 2020). |
| Stooq (the app's `stooq`) | A total-return series (split- and dividend-adjusted as of the dump date), long history | Levels. Some years of renamed tickers belong to another company (PLD before 2011 is the old ProLogis). |
| Corporate actions (`events.json`, `reconcile-events.py`: Yahoo, Tiingo, the option-history steps, SEC share counts) | Split and dividend dates and amounts; spin-off factors | Some spin-offs (Altria's Kraft 2007 and Philip Morris International 2008; Weyerhaeuser's 2010 special in stock) and some cash returns (ConocoPhillips' variable return of cash, 2023). Section 4 finds them in Schwab's adjustments. |
| Option history (DoltHub, `options-iv-features`, 2019-02 → 2026-10) | The put-call-parity spot: an independent as-traded price | Only checks the build (gate 2); three snapshots a week. |

## 3. How a company's series is made (`std-prices.py`)

1. **Tiingo ticker → company.** By ticker, then by prices: a Tiingo series belongs to the company whose Stooq history
   moves with it (the ratio holds still from day to day). BK → BNY, EQR → VMRK, MMC → MRSH, NLOK → GEN and VIAC → SKYD were
   found by prices. A second share class of a company (GOOG beside GOOGL) is left unmatched.
2. **Which vendor carries the company, per date.** Tiingo is not used where it disagrees with both Stooq and Schwab, or
   with Stooq where Schwab has no bar (rolling 21-session agreement below 60%). No vendor is always right: CB's Tiingo
   and Stooq are ACE (right), Schwab is the old Chubb; PLD's Tiingo and Schwab are AMB (right), Stooq the old ProLogis;
   RTX's Tiingo and Stooq are United Technologies (right), Schwab is Raytheon ÷ 2.3348.
3. **Schwab's line.** On every common date, `Tiingo = a × Schwab + b`, constant between events:
   - `a` is the product of the share factors Schwab applied for later events (every split, some spin-offs);
   - `b` is what Schwab subtracted from earlier prices instead: special dividends and some spin-offs as cash values.
   The overlap is cut at every event date and fitted from the seam (2024-04-22) back, each piece expecting the later
   piece's line, as is or carried back through the events between them. A new line is fitted only when neither explains
   90% of the piece. Each step between segments must be explained by an event (section 4).
4. **After Tiingo ends:** the seam's line is carried forward through the later events to today's basis (`a = 1, b = 0`).
   Every split divides it; for spin-offs and special dividends Schwab may or may not have applied, the choice is the one
   that ends on today's basis and whose total return on each event's day matches Stooq's.
5. **Before the overlap, and for the 105 companies Tiingo lacks:** the line is carried back from today (or from the first
   fitted segment) through every split; each spin-off or special dividend is applied only when Stooq's return on its day
   clearly prefers it (by 0.4%, or half the event's size). Schwab's bars are used there only where Schwab agrees with
   Stooq, so another company's years under a reused ticker drop out.
6. **The bar of each session:** Tiingo's where trusted; `a × Schwab + b` where Tiingo is absent, not trusted or wrong that
   day; empty otherwise. A day where Tiingo alone disagrees with Schwab's line takes Schwab's bar when Stooq's move from
   the neighbouring sessions sides with Schwab (XOM 2007-02-06, 2009-03-24).
7. **Overrides** (`std-prices-overrides.json`, reviewed, each with its evidence): DD starts 2017-09-01 (DowDuPont was
   formed 2017-08-31), EVRG starts 2018-06-05 (Evergy was formed 2018-06-04), TPL is marked for review.

## 4. Rules learned (each from a case the gates caught)

- **Schwab subtracts some special dividends instead of dividing:** TransDigm's history is the price minus $281 before
  mid-2019, minus $251, $218.50, $200 and $165 after its later specials; Costco's $7 specials of 2012 and 2017 but not
  those of 2015, 2020 or 2024. It subtracts the as-traded amount from the split-adjusted price, so after later splits
  the subtracted amount reads as amount × split factor (W. R. Berkley 2018: $0.50 shows as 3.375 × $0.50; PACCAR 2018:
  $2.00 as 1.5 × $2.00). Variable dividends lose only their variable part (Devon 2021–2023, Freeport 2022–2023).
- **Schwab applies some spin-offs as a factor** (GE HealthCare 1.2815, GE Vernova 1.253, Alcoa at Arconic 1.334, Altria's
  Kraft 1.25 and PMI 3.25), **some as a cash value** (ConocoPhillips 2012: half a Phillips 66 share, $17.025; HPE 2017;
  Northrop Grumman 2011) and **some not at all** (RTX 2020).
- **Schwab's histories can miss adjustments for stretches** (IDXX before 2007-11-27 misses both later 2:1 splits; RJF
  before 2020 misses the 2021 3:2, a year boundary). Inside the Tiingo era this costs nothing; elsewhere the gates show it.
- **A dividend record may hold the regular and the special dividend together** (Ford 2024-02-15: $0.33 = $0.15 + $0.18).
- **The same dividend can be listed twice** a few sessions apart with a rounded or converted amount (CRH 2022: $1.006 and
  $0.98 six days apart); one is kept. **A spin-off can be listed twice,** as a factor and as a cash dividend of its value
  (HP 2015: Yahoo's 2.202 and Tiingo's $14.72); the dividend goes.
- **Tiingo's bad bars:** the calendar-day fill copies Friday onto the weekend (left out); a flat bar at the previous close
  is no quote (Nucor 2004-10-18, the split's ex-date); a single bar Stooq contradicts by more than 10% that reverses the
  next day is a bad print (Comcast 2004-08-02); a split can show a session after Yahoo's date (West 2004-09-30).
- **An ex-date on a closed day takes effect on the next session** (Nvidia's 2:1 of 2001-09-12, after 9/11).
- **A split that came with an unlisted spin-off** (Expedia 2011-12-21: 1:2 and TripAdvisor) gets the factor Stooq's
  ordinary-day return implies (1.885).
- **Steps seen only in the option history** may be Schwab's adjustments or identity changes: they help decide what Schwab
  applied but never enter the total-return index.
- **Regular-looking large dividends** (a semiannual payer's final dividend, CRH every March) are not treated as specials
  where nothing at today's end checks the choice.
- **A fund has no company row** (SPY and the eleven sector funds): its ticker comes from its own price rows. Without it
  the index missed every dividend (SPY differed from Stooq on 104 sessions; with it, 22).
- **A single bad Schwab bar where Schwab alone supplies the price** is left out when Stooq contradicts it by more than
  3% and the next session reverses it. Example: SPY on 2011-08-02 closed at 132.57 on a third of the usual volume, on
  the day SPY fell 2.6% to 125. 123 bars, most in other companies' years under a reused ticker (KDP before 2018) and in
  TPL's history.

## 5. Acceptance gates (`std-prices-gates.py`) and the first build

Build p1.1 (2026-11-13, the funds' dividends and the Schwab bad-bar rule above) changes the first three rows:
- total return: 6,878 of 2,736,964 sessions differ (0.25%);
- option spot: 505 of 510;
- splits: 440 of 440.

The funds now carry their option folders and their own splits. The table below keeps p1's numbers.

| Gate | Rule | Build p1 (2026-11-13) |
|---|---|---|
| 1 Total return | daily return of `trIndex` against Stooq's adjusted close: differs by more than 0.15% plus rounding | 7,880 of 2,736,974 sessions differ (0.29%) away from events; 2,825 more next to an event (vendors' ex-dates and dividend formulas). The worst are the eleven sector funds and SPY (1.5–5% of days: dividend days placed differently) and PLD's Stooq years of the old ProLogis. |
| 2 Option spot | median `|close ÷ spot − 1|` per company, 2019 on | 486 of 490 below 1%. The four others are option folders of another company or share class (ECHO, DOC, FOX; VMRK with 41 snapshots). |
| 3 Splits | the close times the ratio (with a same-day spin-off or dividend) within 25% of the previous close | 435 of 435; 142 also confirmed by SEC share counts. |
| 4 Gaps, jumps | sessions without a bar inside a span; a daily total return beyond +25% / −20% that Stooq does not show | 5,432 empty sessions (mostly distrusted identity years: CB and PLD before 2006 — the event columns still count); 8 jumps Stooq contradicts (4 are PLD's foreign Stooq years; WMB 2002 twice; GNRC's IPO day; TPL). |
| 5 Known cases | AAPL 2014 7:1, 2020 4:1; NVDA 2021 4:1, 2024 10:1; GE 2021 1:8 and its two spin-offs; TSLA 2020 5:1, 2022 3:1; CMG 2024 50:1; NFLX 2025 10:1 | all right |

Also, from the build itself: every carried-forward line ends on today's basis; 18 steps of Schwab's line stay
unexplained, all in stretches where Schwab carries another company (JCI, CB, LHX, RTX) or misses adjustments (IDXX, RJF).

**Gate 6, market value tie-out** (`marketcap-tieout.py`, 2026-11-13):
- Method: our close × the company's own share count (standard fundamentals `sharesBasic`, the version filed by the date, carried through the splits after that filing) against the Tiingo market cap of the old database, which has a value on the 15th of each month.
- Coverage: 395 companies, 62,256 company-months, 2009 → 2024-04.
- **Price and shares on one basis:** in 97.0% of months the ratio sits within 10% of the company's own level. Only 7 months jump by a split's ratio around a split.
- **Spin-offs in the old database's market caps.** Its market caps are computed with prices already adjusted for later spin-offs, so they understate the company before each spin-off. The ratio equals the spin-off factors:
  - GE 1.6051 = 1.2815 × 1.253 (GE HealthCare, GE Vernova);
  - RTX 1.586; EXC 1.40; T 1.32; also DTE, FTV, MET, LH, PNR, DOV, HSIC, A.
  This is a fact about that table, not about our series.
- **One class or one listing:** the filing's count covers one class or one listing, where the old database counts all (V, UPS, CMCSA, MA, BRK-B; CCL's two listed companies). Market value needs every class: a step-2 item of the fundamentals.
- **Issued instead of outstanding:** some filers tag the year-end count of shares issued as outstanding, treasury shares included. Boeing's 10-Ks run 1.36× in the months after each 10-K and 1.00 otherwise; TYL is similar. This is a step-2 item of the fundamentals.

**Gate 7, levels against the SEC public float** (`export-public-float.mts`, `public-float-check.py`, 2026-11-13).
- Method: each 10-K states the market value of non-affiliates' shares on the last day of the second fiscal quarter (`dei:EntityPublicFloat`). On that day, float ÷ (our close × the quarter's filed share count) should be at or a little under 1.
- Coverage: 466 companies, 6,856 company-years since 2009, Tiingo and Schwab eras alike.
- **97.8% fall within 0.3–1.15.**
- **By era:** 2.3% of the 5,317 Tiingo years and 1.8% of the 1,539 Schwab years fall outside. The levels built from Schwab's line hold up.
- **The outliers are mostly faults in the float facts themselves:**
  - scale slips: exactly ~1,000×, ~0.001 or ~10⁶ (Waters, Domino's, Everest, Corpay, GE 2011, Stryker 2012–14);
  - zero floats (PG&E 2012–16);
  - float dates tagged at the year end instead of mid-year (Mosaic 2025);
  - plus controlled companies and share classes (GoDaddy after its IPO; Blackstone's units).

`std_price_companies.quality` is `review` when an override says so, the option-spot median is 1% or more, or the total
return differs from Stooq on 1% or more of sessions; `notes` holds the reasons, the distrusted stretches, the events
found in Schwab's adjustments and the choices made after Tiingo.

## 6. Running it

```powershell
# 1. corporate actions (Yahoo pull, Tiingo extract, option steps, SEC) -> events.json
python -I reconcile-events.py <yahoo dir> <tiingo dir> <options file> <sec file> D:\research\alpha-engine\prices\events
# 2. the app's prices (read only)
cd C:\dev\alpha-engine; npx tsx C:\dev\alpha-engine-lab\src\prices\export-app-prices.mts D:/research/alpha-engine/prices/app-db/<date>
# 3. the build and its gates
python -I std-prices.py <tiingo dir> <app dir> <events.json> D:/research/alpha-engine/prices/std
python -I std-prices-gates.py D:/research/alpha-engine/prices/std <app dir> D:/research/alpha-engine/options-iv-features <events.json>
python -I marketcap-tieout.py D:/research/alpha-engine/prices/std <fundamentals build dir> <old database marketcap.tsv> D:/research/alpha-engine/prices/std/marketcap-tieout.json
# 4. the research database
npx tsx C:\dev\alpha-engine-lab\src\prices\load-mysql.mts D:/research/alpha-engine/prices/std <version> provisional --replace
```

The build is deterministic for given inputs; `sessions.json` and `tiingo-mapping.json` are cached in the build folder
(delete them to recompute).

## 7. Open

- **Daily continuation:** new bars arrive as traded from Schwab (the split watch keeps the stored history on today's
  basis); appending them to `std_prices` is a later step.
- **Identity by SEC fingerprints:** the CIK's own dividends per share (XBRL) against each vendor's would settle the
  remaining identity years without overrides.
- **Review list:** TPL; COR's dividend list carries CoreSite's years; the sector funds' dividend days; the four option
  folders of gate 2.
- **Use:** market value = close × shares outstanding on the same day's basis (the next step of the fundamentals,
  the owner's instructions), and the valuation factors.


## 8. Weekly gated refresh (K18)

Run `npx tsx ../alpha-engine-lab/src/prices/std-prices-refresh.mts` from `C:/dev/alpha-engine`; the scheduler registers the same command for Sunday at 02:00 local. A run takes about 70 minutes and gets its own `D:/research/alpha-engine/prices/refresh-<runId>/` folder. Existing run folders are not pruned. The previous loaded build remains in place until the final staged swap.

The chain is: a one-time 20-year Schwab backfill for **RIVN and ENLT** (the two registry companies with price series outside the S&P snapshot and research 50), the existing daily-bar loader for those two files, Yahoo corporate actions for all 516 price tickers (including SPY and the 11 sector funds), event reconciliation, app-price export, standard build, and acceptance gates. `tiingo-mapping.json` is reused from the loaded build; `sessions.json` is not copied, so new sessions enter the calendar. The calendar's last date must equal the latest SPY date in the actual app export, including on a Sunday run.

The regression comparator refuses to load when total-return disagreement rises by more than 0.0005, option-spot passes fall by more than two, any split move fails, unexplained steps rise by more than five, any carried-forward line misses today's basis by 0.003 or more, empty sessions rise by more than 200, or any previous company is missing. The build version is `p1.<yyyymmdd>`, status `provisional`.

The loader writes only `std_prices_next`, `std_price_companies_next` and `std_price_builds_next`, checks exact counts and 2,000 random staged bars, writes the build row last, and then performs one atomic `RENAME TABLE`. Old live tables are dropped only after that swap. A failed read-back or any earlier failure leaves the previous tables in place and the staging evidence available for diagnosis. The running summary is checkpointed to `worker/.runs/local-generated/std-prices-refresh.json` and the dated D: folder after every step; a D: interruption stops the chain and resumes from verified checkpoints, never a replacement cache on C:.

The Schwab backfill is the explicitly required local collection step in K18 section 3. It writes only local market-price bars through the existing loader. Production writes and `alpha_engine` production mutation remain forbidden.


### First K18 refresh evidence — 2026-11-14

Run `20261114T072020Z` completed at `2026-11-14T08:51:19.922Z` in 5,385 seconds and is recorded in `worker/.runs/local-generated/std-prices-refresh.json` (post-check hash `1aaf0b5647acd836cc0cb293a760d6bcc62feadd958d103ea5b00c876044406d`). All 516 Yahoo corporate-action requests succeeded with no failure. Reconciliation preserved two source conflicts for review; the standard gate has zero split-move failures.

The regression comparator passed: total-return differing share `0.002513 → 0.002515` (increase 0.000002, limit 0.0005), option-spot passes `505 → 505`, splits `440/440`, unexplained steps `18 → 18`, no carried-forward misses at the 0.003 gate, empty sessions `5,443 → 5,443`, and no previous company missing. The calendar has 9,286 sessions through **2026-11-13**, one more than the loaded build.

The atomic swap loaded **2,894,416 bars and 516 companies** (507 ok, 9 review) as `p1.20261114`, provisional. It performed 2,000 staged read-backs with zero differences. Independent post-check at `2026-11-14T08:54:39.601Z` found the same live counts, latest date `2026-11-13`, one build row, and no remaining `std_*_next` or `std_*_old` tables. RIVN has 1,258 standard sessions from `2021-11-10` through `2026-11-13`; ENLT has 944 from `2023-02-10` through `2026-11-13`.

Artifact SHA256 values: gates `ee738a6b895051c93b82c83a8a655cce533f16d9d39909aeca02f3c0214bfe45`, companies `24241130c85325bec1b38b2ed79bb620c38b7ad873e9459db379fa20918d3dfc`, sessions `9f0b820946c766e20a5e1bc28e4b52059cf10b905043982dd2e65417afa494bb`, load summary `34f9cff9548b44f3fe429d8f8d61ae0be0e686cfb4bcbbdd3ab49a3116bc08e4`.


### Provenance correction K18.1 — 2026-11-14

The `p1.20261114` build ran while the lab's K18 files were uncommitted. The orchestrator then changed once for summary metadata, so it is not byte-identical to the later `268a578` delivery. `codeCommit` therefore remains `0e5be4a806d3ee5db7957b39ffcd77247613d132`; it was not falsely replaced. The row's note is now "built from uncommitted lab code; staged load and atomic swap; provenance noted in K18.1; next Sunday produces a clean build". A guarded one-row update changed only that note and independently verified every other field. Evidence: `worker/.runs/local-generated/std-prices-refresh-provenance.json`, SHA256 `236fb2bf30746c4159b16c7042bad073c0bc9e9d0e6eb19b137e6522648b6548` (run/delivery orchestrator hashes `20e0b0ec…` / `6a7d3f98…`).

Lab `443789f35357cbdd6895375be5f19e447cb84cb7` adds a preflight guard and regression: the orchestrator refuses to start when any runner file has uncommitted changes. The guard covers the orchestrator, comparator, loader, build/gate/reconcile/Yahoo/export scripts, overrides and research connection. It runs before collection or any database write; a clean tree records the exact HEAD in the summary. The next Sunday run will therefore carry a clean code commit.
