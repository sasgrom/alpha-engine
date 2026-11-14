# Standard options — one constant-maturity reading per company and session

The lab builds `alpha_research.std_option_daily` and `std_option_builds` from the existing option archives. It does not refresh the Dolt clone, fetch new chains, change `alpha_engine`, alter app signals, or write production. Code and tests live in `C:\dev\alpha-engine-lab\src\options`; raw and derived artifacts stay under `D:\research\alpha-engine\options-std\<runId>`.

## 1. Inputs and availability

- **DoltHub:** `D:\research\alpha-engine\options-iv\<ticker>\<year>.csv`, read from disk, not the Dolt clone. The clone's last export is 2026-10-28. Each row has bid, ask, vendor IV and greeks, but no volume or open interest.
- **Schwab:** `D:\research\alpha-engine\schwab\chains\<date>\<ticker>.json` for the research 50 and `D:\research\alpha-engine\schwab-sp500\chains\<date>\<ticker>.json` for the rest of the index. Existing files and their `manifest.json` capture times are used as-is. `normalizeSchwabChain` supplies contract structure, delayed/truncated evidence and decimal IV: raw volatility `29.0` becomes `0.29`. The lab adapter consumes that decimal value unchanged; it must not divide it by 100 a second time. An integration regression passes a real raw chain through both the shared normalizer and the lab adapter.
- **Prices:** the current `alpha_research.std_prices` build, using as-traded close, `splitIndex`, `trIndex`, split events and its actual `sourceDir/sessions.json`. The K18 refresh is used when it is the loaded build; an older `std/sessions.json` cannot silently truncate the calendar.
- **Release calendar:** `engine/events/quarters-50.jsonl` and `quarters-rest.jsonl`, using `firstPublicationEt` only for release/event fields.
- **Parity spot:** the existing `impliedSpot` in `worker/lib/dolthub-features.ts`, computed from call and put mids at the strike whose prices are closest. A later split never repairs a wrong identity match with a factor.

`availableFrom` is the session **after** the quote session. A decision at a close may not use that close's own quotes. Exactly one row is retained per `(cik, source, quoteSession)`: the later DoltHub `snapshotDate` or Schwab `capturedAt` wins. DoltHub is deduplicated too, including Friday/holiday snapshots mapped to the same session; different sources remain distinct. Deduplication happens before all QA, seam, split and load calculations. `duplicates.json` retains the kept and discarded snapshot/capture timestamps and spots, and `coverage.duplicates` records the count.

## 2. Which session a snapshot reflects

DoltHub date D has end-of-day quotes. The candidates are the last session on or before D and the session before that. The candidate whose as-traded close is nearest to parity wins, with its gap and whether D itself matched retained. Weekend and holiday snapshots therefore fall to the previous session, never into the future.

Schwab uses `capturedAt` converted to America/New_York:

- after 16:00 on a session day: that session;
- before 09:30: the previous session, marked `intraday`;
- between 09:30 and 16:00: that session, marked `intraday`;
- a weekend or holiday: the last prior session.

Parity must be within 20% of the selected as-traded close. Otherwise the snapshot is refused and listed. This is the identity guard against reused tickers (COHR, ECHO, DOC, COR, IR and similar cases).

## 3. The reading

For each expiration, calendar days from the quote session determine `T = days / 365`. Expirations under seven days are excluded from ordinary readings but may be used by the event formula.

- **Forward and ATM:** at the strike where call and put mids are closest, `F = K + C − P`. Vendor IV is interpolated linearly in `ln(K/F)` between the strikes bracketing F, averaging call and put IV at a strike or using one side when the other is missing.
- **25 delta:** put IV at −0.25 and call IV at +0.25 are interpolated between the two bracketing strikes. No extrapolation is allowed; a missing bracket produces null and the `missing25d` flag.
- **Call-put spread:** the mean call IV minus put IV at strikes having both, with call delta 0.3–0.7.
- **Constant maturity:** at 30, 60 and 91 days, total variance `σ²T` is interpolated linearly in T and converted back to σ. If only one side exists, the nearest expiration may be used within ten days, marked `extrapolated`; otherwise the reading is null.
- **Stored values:** `iv30`, `iv60`, `iv91`, `skew30 = put25 − call25`, `putSkew30 = put25 − atmIv`, `cpSpread30`, and `termSlope = iv91 − iv30`. Skew and spread interpolate linearly in T, not in variance.
- **Realized volatility:** `rv21` uses 21 log returns of `trIndex` through the quote session, annualized by `sqrt(252)`. `vrp30 = iv30 − rv21`. Forward 21-session volatility is used only for QA and is never stored.
- **Quality:** contract and expiration counts, zero-bid share, ATM relative spread and flags (`extrapolated`, `missing25d`, `intraday`, `delayed`, `truncated`, `releaseInside30`).

## 4. Event readings

A release inside 30 calendar days is retained with its actual `firstPublicationEt`; announcement lead time is normally 2–4 weeks. Event calculations require the publication to be within ten sessions of the quote, keeping the readings inside that notice window.

`E1` is the first expiration after the publication's first trading session, `E2` the next. With `T1` and `T2`:

```
σd² = (σ2²T2 − σ1²T1) / (T2 − T1)
eventMoveTerm = √((σ1² − σd²) × T1)
```

The term is null when E2 is missing or the root is not positive. `eventStraddle` is E1's ATM straddle mid divided by parity spot.

## 5. Spot, split and seam checks

DoltHub's snapshot label does not prove that its quotes were captured at the official closing price. The spot gate therefore uses the quote session's actual as-traded range, not a one-percent distance from its close:

```
lower = low × 0.99
upper = high × 1.01
pass when lower <= paritySpot <= upper
```

At least 98% of snapshots must pass, with no uncomputable range silently accepted. Every outside row is retained with its low, high, padded bounds, side and distance to the nearer edge. Raw and dividend-adjusted close gaps, the shares within 1% of the close and dividend PV remain reported per ticker and year, but do not replace this gate. Missing own-class price series remain explicit exclusions under `classWithoutPriceSeries`.

For every in-scope split since 2019, the observed spot ratio is checked against both sessions' as-traded ranges:

```
rawRatio = spot_after / spot_before
lower = (low_after / high_before) × 0.99
upper = (high_after / low_before) × 1.01
pass when lower <= rawRatio <= upper
```

The build also retains the former price-only close normalization as a diagnostic, never as the amended gate:

```
priceMove = (close_after × splitIndex_after) / (close_before × splitIndex_before)
normalizedRatio = rawRatio / priceMove
expectedRatio = (1 / splitRatio) × priceMove
```

Both snapshot dates, sessions between them, low/high values, range bounds, raw ratio, price move, normalized ratio and expected ratio are recorded. More than five sessions apart is `weak` evidence even when it passes. Every range failure and weak case stays in the QA list. A source outside its coverage period is not marked as a split failure merely for lacking snapshots. KLAC 2026-06-12 and BKNG 2026-04-06 pass this range test despite failing close normalization; this corrects the mistaken assumption that the option snapshots were closing quotes.

The IV change is also compared with the company's 99th percentile of ordinary one-snapshot changes and listed with a release, March-2020 or data reason when it falls outside. These reported IV outliers do not silently turn into an unqualified spot-ratio gate. All split cases remain available, not only failures. The 20 largest IV30 moves each carry a reason. For the research 50, the DoltHub-to-Schwab seam reports median and interquartile range of the absolute IV30 change. Each company's ordinary 95th-percentile move uses only DoltHub pairs spanning the **same number of standard sessions** as that company's seam; `seam.baselines` retains the gap, comparison count, baseline and every outlier.

Schema 3 comparisons require equal parity spots and compare the old 8–30D/31–90D `atmIv` with the new reading interpolated to the old `dteMedian`, including correlation and the largest differences.

Per year, rank correlation across companies between IV30 and the next 21 sessions' realized volatility must be at least 0.6 with at least 30 pairs. This forward volatility is a QA input only. A one-company smoke is diagnostic, not the cross-company acceptance test.

## 6. Schwab-only readings and provenance

Put/call volume and open-interest ratios are stored only for Schwab sessions and are explicitly Schwab-only. They never create a series before 2026-10-31.

The builder and reviewer refuse dirty option runner code before collection or review. `buildVersion` is `o1.<yyyymmdd>`, status `provisional` until review, and `codeCommit` is the exact clean lab HEAD used for the build. The loader records its own exact commit separately. Dated D: folders and old builds are not pruned.

The loader writes `std_option_daily_next` and `std_option_builds_next` in autocommitted batches of at most 500, writes the build row last, checks exact counts and 2,000 random staged rows against the JSONL evidence, then performs one atomic `RENAME TABLE`. Old tables are dropped only after that swap. A failed gate or any read-back mismatch leaves the previous tables in place. Driver-shaped regressions cover millisecond ISO timestamps against whole-second `DATETIME` strings, `TINYINT(1)` booleans against JSON booleans, and JSON text flags against arrays. `canonicalTimestamp` truncates `capturedAt` to whole seconds, and `databaseTimestamp` emits that value as a space-separated SQL `DATETIME` literal **before insert**. This neither relies on MySQL rounding/truncation nor sends an ISO `T/Z` literal that the driver rejects. Regressions cover `.168`, `.400`, `.568`, a `23:59:59.600` day boundary and SQL-literal rejection; no `DATETIME(3)` schema change is made. The exact loader commit is recorded in build inputs, the DB note and `load-summary.json`. Numeric read-back uses a relative `1e-12` tolerance for DOUBLE rendering only, with every accepted rounding case recorded separately; substantive mismatches still refuse the swap. After a swap, a separate read-only verifier samples 2,000 rows uniformly across the complete artifact, checks every column and the live build row, and refuses leftover `_next` or `_old` tables. Public app pages, signals and production are outside this task.


## 7. Identity corrections and anomaly evidence

Parity is not compared naively with the close when dividends go ex before expiry. For the parity expiration (or the shortest usable expiration when there are several), the spot check uses:

```
adjustedClose = closeAsTraded − Σ dividends with quoteSession < exDate <= expiration
adjustedGap = |paritySpot / adjustedClose − 1|
rawGap = |paritySpot / closeAsTraded − 1|
```

Actual later dividends are valid for this QA comparison, not for a trading signal. `closeAsTraded`, `rawSpotGap`, `dividendPv` and adjusted `spotGap` are all stored, and raw/adjusted close coverage is reported per ticker and year. This tests special dividends and sector-fund distributions rather than hiding them. It does not silently move the explicitly defined raw traded-range bounds.

Every chain must match its own class's underlying **traded symbol**, not merely the company's display label. The price-series selector is `tiingoTicker`, falling back to the company ticker; Dolt and Schwab source symbols are checked against that same selector. Punctuation aliases are normalized only when the resulting identity is identical (for example BRK.B and BRK/B). A missing own-class archive cannot fall back to the other class.

The mapping is explicit in `coverage.classPriceSeries`: FOX uses pseudo-CIK `-2002` with traded symbol FOX; CIK `1754301` retains its company label FOX but uses FOXA prices and FOXA chains. NWS similarly uses `-2003` rather than NWSA `1564708`, and GOOG uses `-2001` rather than GOOGL `1652044`. BF-B/BF-A remain separate. The price tables and their labels are not patched by the option build. Per-year spot groups include CIK, so classes sharing a display label are not merged in the QA statistics. A genuinely missing own-class price series is listed under `classWithoutPriceSeries` and excluded from the spot gate; a missing option chain is separately listed under `companiesWithoutChains`.

These are cause-based exclusions, not a blanket anomaly list. If range coverage remains below 98%, any range is uncomputable, or a split spot ratio falls outside its two sessions' ranges, the build stops before loading and the remaining ticker/year evidence is reviewed. Split evidence includes per-expiration parity spots and strike grids. Fractional strikes alone are not proof of a non-standard deliverable; when the source has no deliverable field, no such exclusion is invented.


## 8. Verified provisional build — 2026-11-14

The reviewed artifact is `D:/research/alpha-engine/options-std/20261114T130038Z`. Its status is **provisional until Claude accepts it**. The original blocked artifact `20261114T122858Z` remains unchanged at SHA256 `7125c47a1323fa70e22682d0ce7f924f067efa248eb3a43dbc804672f174ea7f`; the reviewed copy has 511 byte-identical source files (510 daily JSONL files plus `duplicates.json`). Data build code is `fb27f8b`; the fixed stress review and precision work is `af7e51a`; the SQL DATETIME loader correction is `1d67b73`.

The loaded research build has **541,973 rows across 510 companies**, from 2019-02-08 through 2026-11-13. There are 67,818 documented duplicate choices. BNY, GEN, MRSH, NVR, SKYD and VMRK have no rows. `classWithoutPriceSeries` is empty; all seven own-class mappings are explicit, and the 1,900 identity refusals remain listed.

- **Spot:** 536,829 / 541,973 = **99.0508752%** inside the traded range, with zero uncomputable rows. All 5,144 outside rows and their nearer-edge distances are retained. Raw/dividend-adjusted within-1%-of-close shares are 95.7789410% / 96.6291679%, with per-CIK/year evidence.
- **Splits:** 65/65 spot-range passes, zero weak cases and zero spot failures. WRB, CMG and BKNG retain their IV-only outliers and publication reasons. All 65 cases and the 20 largest IV jumps are retained.
- **Schema 3:** 1,135,538 comparisons, zero spot mismatches and **0.9826244618** old/new IV correlation.
- **Seam:** median absolute change 0.0309730991; Q1 0.0214136956; Q3 0.0490867471; IQR 0.0276730515. AMZN, PLTR, GOOGL and DASH are outliers against their own same-session-gap baselines, with comparison counts retained.
- **Sanity:** 2019 0.7049737639; 2021 0.7320597667; 2022 0.7096879731; 2023 0.6971616775; 2024 0.6699928537; 2025 0.6686347242; 2026 0.7578382533. Full-year 2020 remains **0.5985565509 on 64,335 pairs and marked failing**.

The separately recorded stress exception is exact: **"accepted with exception: 2020 sanity below 0.6 from the COVID crash window"**. The predeclared 2020-02-20 through 2020-04-30 overlap window has rho **0.3133552765 on 17,616 pairs**, while the rest of 2020 has rho **0.7260783391 on 46,719 pairs**. March has rho −0.0159607566; Q1 has rho 0.5471567650. Every other year has identical pairs and rho under the window rule. No rows were removed and the 0.6 full-year threshold was not changed. Future builds retain this gate and fixed exception test; another year below 0.6 cannot use it.

The loader used batches of at most 500, wrote the build row last, checked 2,000 staged rows with zero mismatches and recorded 25 DOUBLE rendering cases within a relative `1e-12` tolerance, then completed one atomic swap. The first attempt failed before swap with only 1,000 staging rows and zero live rows because the driver rejected ISO `T/Z` DATETIME text; `failed-load-20261114T130606Z.json` preserves that incident before the corrected SQL-literal retry.

Independent post-swap verification at `2026-11-14T13:19:54.379Z`, seed `1957257680`, confirmed **541,973 live rows and 541,973 distinct `(cik, quoteSession, source)` keys**, 510 companies, one provisional build, 2,000 uniformly sampled complete rows with zero mismatches, and 23 separately reported DOUBLE rendering cases. No `_next` or `_old` table remains.

All **25 option tests in seven files**, both standalone TypeScript checks, the main TypeScript check, **259 main test files / 1,443 tests**, and the production build pass. No production write, `alpha_engine` mutation, Dolt refresh, new Schwab collection, scheduler/web restart, credential access, GDELT request, model promotion or alpha claim occurred.

Evidence hashes in the reviewed folder:

- `build.json`: `c12e1c5711236a9f334a5b1e072a4b792f5edb9750063143f4ae1be19650c1ac`
- `duplicates.json`: `d12e44ebc2cf3d23236d092ed370d0138597e885fd351b670ec92385058861aa`
- `load-summary.json`: `59a33caec7762e304b8560d9f58c28eed1b34410e759e0e3ab1c3093ddc9587e`
- `independent-live-check.json`: `fd7dc2aae6a6eb7c113034994a1873da002208381ebfe2dd5a08303fcc18d40a`
- `source-preservation.json`: `f460fa95204da4c4d0bc69a86e002fa2f528147eb693e126f27d223997142fc6`
- `sanity-stress-diagnostic.json`: `774077ccb2ac7f9fb0fa44a393c1520ee5c7098d0a61162aed9c1cf53292d191`
- `delivery-summary.json`: `9e3c0c5acafb322b157977aad859c5f2324edf40933a2251382cfb9ef2dc4b85`


## 9. Symbol validity and co-movement identity

K19.1 adds issuer-specific validity windows. A chain is assigned to a CIK only when its source symbol is valid for that issuer on the snapshot date. Out-of-window rows are refused and listed; they are never assigned to another issuer or silently retained because their parity happens to be near the current close.

- **COR → Cencora (CIK 1140859) from 2023-08-30.** Accession `0001104659-23-096698` says the common stock stopped trading as ABC and began trading as COR at that market open. Evidence: [Cencora Form 8-K](https://www.sec.gov/Archives/edgar/data/1140859/000110465923096698/tm2324358d1_8k.htm). Older COR chains belong to CoreSite, not Cencora.
- **ECHO → EchoStar (CIK 1415404) from 2026-06-24.** [EchoStar's official release](https://ir.echostar.com/news-releases/news-release-details/echostar-changing-stocker-ticker-sats-echo-marking-companys-next) says ECHO began trading on Nasdaq that day; [OCC memo 59221](https://infomemo.theocc.com/infomemos?number=59221) confirms the option-symbol change. Older ECHO chains belong to Echo Global Logistics, not EchoStar. The 2024 merger is not used as the ticker-effective date.

The source/session-deduplicated rows are then grouped by CIK, ticker, source and quote-session year. Consecutive rows in one group produce `Δlog(spot)` and `Δlog(closeAsTraded)`. With at least 15 intervals, the gate computes their Pearson co-movement and the mean absolute raw close gap. Co-movement below 0.5 with a mean raw gap above 5% is an unresolved identity flag and blocks loading. A weaker co-movement with a mean raw gap of at most 5% is listed as noisy thin parity and retained, not mislabeled as a wrong company. Every flag must be resolved before loading.

The initial diagnostic covered 3,703 ticker-years. COR 2021 was the only unresolved case (co-movement 0.316471, mean raw gap 0.103948). WRB 2025/2026 and HST 2026 were explicitly retained as thin parity with small gaps. This is a separate identity check from the 20% parity guard and from the 98% range gate.

Raw validity refusals are reported separately from net stored-row removals. COR has 337 raw refusals and ECHO 300, including 220 and 206 rows respectively that the old parity guard had already rejected. The prior provisional build therefore loses exactly **117 COR rows and 94 ECHO rows**, not the full raw-refusal counts. Historical aliases such as ABC and SATS are not backfilled by this correction; that would require a separately reviewed symbol-history source.


## 10. K19.1 verified correction — 2026-11-14

The corrected artifact is `D:/research/alpha-engine/options-std/20261114T135938Z`, built and loaded **provisionally** at lab commit `fcac02f09868fa32601bafaaef09c8105e21515c`. The previous artifact `20261114T130038Z` remains unchanged at SHA256 `c12e1c5711236a9f334a5b1e072a4b792f5edb9750063143f4ae1be19650c1ac`. Claude must review the correction before marking K19 final.

The corrected build contains **541,762 rows across 510 companies**, exactly 211 fewer than before. Independent full-key comparison proves **117 COR removals and 94 ECHO removals**, with zero valid additions, unexpected removals, duplicate keys, or current validity failures. The 337 COR and 300 ECHO raw validity refusals include 220 and 206 rows already rejected by the old parity guard; they are not additional net removals.

- **Spot:** 536,811 / 541,762 = **99.0861301%** inside range, with zero uncomputable rows and all 4,951 outliers listed. Raw/adjusted close shares are 95.8140290% / 96.6651408%.
- **Identity:** 3,699 ticker-years, **zero unresolved flags**. WRB 2025/2026 and HST 2026 remain listed and retained as noisy thin parity, with mean raw gaps below 5%. COR 2021 and ECHO 2020 no longer contain the reused issuer's rows.
- **Splits:** 65/65 spot-range passes, zero weak/spot failures; WRB, CMG and BKNG retain their publication-tagged IV outliers.
- **Schema 3:** 1,135,139 comparisons, zero spot mismatches, rho **0.9826194617**.
- **Sanity:** full-year 2020 remains below 0.6 at **0.5987534001 on 64,252 pairs**. The fixed stress exception has rest-of-year rho **0.7262022381 on 46,644 pairs** and crash-window rho **0.3134012643 on 17,608 pairs**. Other years are unchanged and pass. The exact exception note remains "accepted with exception: 2020 sanity below 0.6 from the COVID crash window".
- **Seam:** median absolute change 0.0309730991, IQR 0.0276730515; AMZN, PLTR, GOOGL and DASH remain the same-gap outliers.

The staged loader used at most 500 rows per batch, wrote the build row last, checked 2,000 rows with zero mismatches and 20 separately recorded DOUBLE rendering cases, and completed the atomic swap. Independent live verification at `2026-11-14T14:20:15.603Z`, seed `4276538446`, confirmed **541,762 live rows and unique source-session keys**, 510 companies, one provisional build, **2,000 full-row checks with zero mismatches**, 18 rounding-only cases and no `_next` or `_old` tables. The separate full-key identity comparison passed at `2026-11-14T14:20:13.633Z`.

All **29 option tests in eight files**, the standalone option and verification TypeScript checks, the main TypeScript check, **259 main test files / 1,443 tests**, and the production build pass. No production write, `alpha_engine` mutation, Dolt refresh, new Schwab collection, historical-symbol backfill, scheduler/web restart, credential access, GDELT request, LLM bulk processing, model promotion or alpha claim occurred.

Corrected-artifact hashes:

- `build.json`: `2cf7b7678c8d111fad13fb0d90c38e8ae05caad460c0118408b938fe7bbc4308`
- `duplicates.json`: `e9069cea2a813f75d168f115c294e491503dcbf078cf510fdf645d6a529a1cde`
- `identity-difference-check.json`: `2dda5e208f677d2881dc9c8c38ef07ce64f63e9b66de6c47bc55dbabd4089162`
- `sanity-stress-diagnostic.json`: `5ce3246d21fa2dfd9b33f58d8a2f1bc5887a001e689dda0666aef2d07f2fceb7`
- `load-summary.json`: `29050c467b48eb9126b179ed96360b180faadcc18af1cbb3638e69dc780de552`
- `independent-live-check.json`: `fd79810a629d5c6348eab6d0ae405dbb47423efd40d1a133256d56c5dcceff03`
- `delivery-summary.json`: `de9583b5530c339e7c1eafe09111661df1ea36d26d73d173fa23d99ea8e1b075`


## 11. Final registration — 2026-11-14

Claude accepted K19 after independently checking the corrected rows, validity windows, duplicate keys and co-movement evidence. The unchanged `20261114T135938Z` artifact was then loaded once more with status **final**, replacing only the provisional build metadata as permitted by the loader.

The live `std_option_builds` row is `o1.20261114`, status **final**, code `fcac02f09868fa32601bafaaef09c8105e21515c`, with **541,762 rows / 510 companies**. Final independent verification at `2026-11-14T14:37:42.190Z`, seed `95391474`, confirmed 541,762 unique source-session keys, **2,000 full-row checks with zero mismatches**, 27 separately reported DOUBLE rendering cases and no `_next`/`_old` tables. A second replacement was refused as designed; staging remained empty and the accepted rows were unchanged.

Final hashes:

- `build.json`: `cfbb0def33e290fafbd614f910fe90f4c1cb6c47b68bb4d6cafa6998540aa8d1`
- `load-summary.json`: `f4ace5513bb23561d68b79a7cba31ad524ac58a32c4ee6c5e224e994345f5bdd`
- `independent-live-check.json`: `c60628fe980ae74db9074262a87bc230e175e9ed3998eb1f14a281c629fb811a`
- `identity-difference-check.json`: `e2deabfc9856c92af1c2fa8062aa8b1635ddebce1401ec3224b29698bb4162fa`
- `delivery-summary.json`: `91594659690ed99314b8babf255ff91b1a5d83b13074c8fa14906baba04301ff`
- `duplicates.json`: `e9069cea2a813f75d168f115c294e491503dcbf078cf510fdf645d6a529a1cde`
- `sanity-stress-diagnostic.json`: `5ce3246d21fa2dfd9b33f58d8a2f1bc5887a001e689dda0666aef2d07f2fceb7`

This is a local research-build finalization, not production transport or an alpha-signal promotion. K20 is the next approved queue item; K19.2 historical-symbol coverage still requires a proposed symbol-history source.
