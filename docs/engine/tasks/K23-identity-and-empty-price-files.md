# K23 — Six companies without identity, five empty price files

Task for Kimi Code. **Approved by the owner on 2026-11-16** ("prepare instructions for kimi to complete what u think is
necessary and send it to him"). Written by Claude the same day. Run it after K20 is delivered and before K12.

## Why

Two defects found during Claude's research on 2026-11-16. Both silently drop companies from research.

**1. Six companies carry placeholder identities.** In the standard fundamentals v3.1 company documents
(`D:\research\alpha-engine\fundamentals\standard\v3.1\company\<cik>.json`) these six have ticker `CIK<cik>`, name
`CIK <cik>` and no sector or industry. Their numbers and their standard prices are fine; only the identity is missing.

| CIK | Company (check against the registry's own source) | Ticker |
| --- | --- | --- |
| 27419 | Target Corp | TGT |
| 46080 | Hasbro, Inc. | HAS |
| 76334 | Parker-Hannifin Corp | PH |
| 766704 | Welltower Inc. | WELL |
| 1113169 | T. Rowe Price Group, Inc. | TROW |
| 1116132 | Tapestry, Inc. | TPR |

What breaks downstream:
- None of the six is in K06's universe (`D:\research\alpha-engine\engine\events\universe-rest.json`, 446 companies), and
  none is in the research 50. So they have no release calendar, no cached releases, and K12 would skip them.
- No sector, so no sector fund in the engine tests. Stooq intraday files are keyed by ticker, so the hourly and
  5-minute tests skipped them.
- Matching by name or ticker fails (Claude had to patch them by hand when building S&P 500 membership).

**2. Five standard daily price files are empty** (header only) in `D:\research\alpha-engine\prices\std\daily\`, build
`p1.20261114`:

| CIK | Ticker | First price | Rows the gates compared |
| --- | --- | --- | --- |
| 1874178 | RIVN | 2021-11-10 | 1,243 |
| 2058873 | Q (Qnity Electronics) | 2025-11-03 | 256 |
| 2082247 | FDXF (FedEx Freight) | 2026-06-01 | 113 |
| 2089271 | HONA (Honeywell Aerospace) | 2026-06-29 | 94 |
| 2128626 | VYLR (Vylor) | 2026-10-01 | 28 |

`companies.json` of the price build lists each with first and last price dates and gate counts above zero, so rows
existed at gate time and were lost when the file was written. They have no Tiingo history in common: RIVN's notes show
`afterTiingo.noOverlap = true`; check the other four. The likely place is the weekly refresh (K18) or the build's file
writer, for Schwab-only series.

## Rules

- **Do not overwrite data** (owner's rule). Final numeric tables stay byte-identical (`std_fundamentals` v3.1,
  `std_prices` rows of other companies, K06 files). Identity fixes go into the registry the builds read, plus a
  versioned, documented identity correction. If a final artifact must carry the corrected identity, write a new version
  next to it and keep the old one.
- Take each company's ticker, name, sector, industry and SIC from the same source the other 494 companies use. The
  table above is only a cross-check; a disagreement is reported, not silently resolved.
- Use only existing collectors at their usual pace. Downloads are limited to the six companies' SEC filings and release
  exhibits for part B. No production write, no schema change, no model call.
- The AGENTS.md section 3.1 D: protocol applies: checkpoints, no C: fallback, resume after a remount check.

## What to do

**A. Identity.** Correct the six in the registry. Regenerate whatever identity outputs the standard builds publish
(company lists for fundamentals and prices), as new versions. Then search the other research inputs for `CIK<digits>`
placeholder tickers and list any further cases.

**B. Release calendar and documents for the six.** Run K06's collector for the six companies only: filings,
earnings-release flags, quarter pairing and cached release exhibits from 2009-01-01, with K06's point-in-time checks.
Write them as an addendum (for example `filings-six.jsonl`, `quarters-six.jsonl`, `universe-six.json`, with the
exhibits in K06's cache layout), or as new versions of the rest files with the old ones kept. Never edit K06's files in
place.

**C. Empty price files.** Find why the five files were written empty and fix the writer, with a regression test on a
Schwab-only fixture. Regenerate the five files (they are empty, so nothing is overwritten) and check them against
`alpha_research.std_prices`. If the database rows are missing too, load them in batches of at most 500. Add a gate: a
company with a first and last price date must never get a header-only daily file.

## Acceptance checks

1. The six show correct ticker, name, sector, industry and SIC in the registry and in the regenerated identity outputs.
   Before/after hashes and row counts prove that no numeric value of any table or file changed.
2. Addendum for the six: filings and releases per company and year, the share of quarters paired, and K06's
   point-in-time audit with 0 violations. K06's original files are byte-identical.
3. The five price files have rows that match the gate counts and the database: first and last date, row count and a
   hash of the closes. The new gate fails on a header-only file in a test.
4. The list of any other placeholder identities found in research inputs.
5. `npm run check`, the targeted tests, `npm test -- --run`, `npm run build`, `git diff --check`.

## Delivery

A delivery report in this file, a handoff note, and a mailbox message to Claude. Claude then updates the lab's n1
company list from the corrected registry, and K12 runs over K06 plus the six (452 companies).


## Delivery — Kimi Code, 2026-11-16

### A. Identity

The six CIKs were absent from the local app registry. The dry run was followed by
`npx tsx C:/dev/alpha-engine-lab/src/k23/identity.mts --apply 20261116T143242Z`. GICS supplied ticker, sector and
industry; cached SEC submissions supplied name, exchange, SIC and SIC description, with the ticker cross-check enforced
in code. The registry count changed from **496 to 502** and every registry, fundamental-company and price-company
post-check passed. No production write or schema change occurred.

| CIK | Ticker | SEC name | Sector / industry | SIC |
| --- | --- | --- | --- | --- |
| 27419 | TGT | TARGET CORP | Consumer Staples / Consumer Staples Merchandise Retail | 5331 Retail-Variety Stores |
| 46080 | HAS | HASBRO, INC. | Consumer Discretionary / Leisure Products | 3944 Games, Toys & Children's Vehicles (No Dolls & Bicycles) |
| 76334 | PH | Parker-Hannifin Corp | Industrials / Industrial Machinery & Supplies & Components | 3490 Miscellaneous Fabricated Metal Products |
| 766704 | WELL | WELLTOWER INC. | Real Estate / Health Care REITs | 6798 Real Estate Investment Trusts |
| 1113169 | TROW | PRICE T ROWE GROUP INC | Financials / Asset Management & Custody Banks | 6282 Investment Advice |
| 1116132 | TPR | TAPESTRY, INC. | Consumer Discretionary / Apparel, Accessories & Luxury Goods | 3100 Leather & Leather Products |

Versioned outputs, without overwriting v3.1 or n1:

- `D:/research/alpha-engine/fundamentals/standard/v3.1-identity-20261116T143242Z/company` and `index.json`; index
  SHA256 `bb570739b8bc37ed90c77caf752c6a946561005e68447b1220c9aeccd09291b5`.
- `D:/research/alpha-engine/prices/std-identity-20261116T143242Z/companies.json`, SHA256
  `bb04f3b703feefc83151429993246f11c131eaeebbf39f7a67385878e4532e8a`.
- `D:/research/alpha-engine/fundamentals/normalized/n1-identity-20261116T143242Z/inputs/companies.json`, SHA256
  `803475e58e02f7849caf1aa32a324168ebd37ab3c3ba3b6d018bec9f95ab4c13`.
- Evidence report `D:/research/alpha-engine/k23/identity-20261116T143242Z.json`, SHA256
  `94f8e73837887162e55338bac6680b7b1a8f442654c79ed19567222b94f6bdc8`.

All **494 unaffected company documents are byte-identical**. Removing only ticker and name from the six before/after
company documents gives identical SHA256 values, respectively:
`ffaf26963324a96820d1541f6c7a1751377bdb517278f32800053b043cb596be` (TGT),
`aa9f57ee517f0c120e05c6d0086c07438ac6980a5168cf28617c0ee9236d0460` (HAS),
`bd3bf8a5b32cc188cf65ec57e5ba3429b42be68ebfa0b18d7d0901a80db856bf` (PH),
`9fdc6709e158c776a9b89f5ab3300ac918f2cd4c3b184ff1e54582b74e40d144` (WELL),
`5314fe89f545d38c4fb4f8370247a3964c54bcaf84ad05744a1b40a403f50b00` (TROW), and
`8c2bcd31909c606fc896472b1c8a8aecce38d1cde124838ccc11f8c205aa255d` (TPR). The registry repair changed only the
six new identity rows and the corresponding research ticker/name fields; no numeric table was rebuilt.

`std_fundamental_companies` now has zero `CIK%` placeholder tickers. The completed scan found only these same six
historical placeholder identities in `engine/walk/w1/manifest.json` and its six company JSON files. Those historical
outputs were not edited; consumers should use the corrected registry. A broader recursive D: text scan hit its 20-second
limit, so **no additional CIKs appeared in the completed subset, but the scan was not exhaustive** and this is not a
claim that no placeholder exists anywhere else on D:.

### B. Six-company release-calendar addendum

`npx tsx scripts/build-release-calendar-rest.mts --ciks 27419,46080,76334,766704,1113169,1116132 --addendum six`
completed at lab/main collector code `f1bf36d8add13748f16bcfcef66e532c90cbe444`. The collector can now bootstrap
missing registry identities, use an isolated suffix, and size a filtered run to the requested universe rather than the
ordinary 20-company target. It made no database or production writes.

Overall **6/6 companies passed**, with **2,069 filings, 527 quarters, 516 releases**, 256,826,026 bytes, all **30/30**
seeded EDGAR index checks matched, and zero unexplained exhibit outcomes. Of 516 release outcomes, 513 have files and
three have explicit no-exhibit reasons: HAS `0000046080-11-000010`, WELL `0001193125-19-013531`, TROW
`0001113169-13-000007`. Point-in-time checks pass: chosen releases are first, duplicate company-periods, negative lags,
missing original accessions, non-increasing next publications and amendment-only periods are all zero. Full evidence is
in `research/engine/event-calendar-six.summary.json`.

Per company: `F` = filings by calendar year, `Q/R` = fiscal quarters / paired releases.

- **TGT:** 395 F, 87 Q, 87 R (100%). F 2005–2026: 27,16,19,25,26,21,17,18,20,19,18,23,12,13,12,19,15,16,15,14,16,14.
  Q/R: 4/4 for 2005–2025; 3/3 for 2026; 98 release outcomes.
- **HAS:** 335 F, 88 Q, 85 R (96.59%). F 2005–2026: 18,17,16,15,14,21,14,13,15,21,16,12,12,13,15,15,14,19,16,14,9,16.
  Q/R: 2004 1/1; 4/4 in 2005–2007, 2010, 2012–2025; 4/3 in 2008, 2009, 2011; 2026 3/3; 95 release outcomes.
- **PH:** 307 F, 88 Q, 87 R (98.86%). F 2005–2026: 18,12,20,11,13,16,11,10,15,11,14,13,20,9,19,9,18,17,12,11,14,14.
  Q/R: 2004 1/1; 4/4 in 2005–2016, 2018–2025; 2017 4/3; 2026 3/3; 91 release outcomes.
- **WELL:** 473 F, 88 Q, 87 R (98.86%). F 2005–2026: 19,26,22,24,19,23,30,36,28,22,20,14,18,23,21,18,19,23,18,19,16,15.
  Q/R: 2004 1/1; 4/4 in 2005–2017, 2019–2025; 2018 4/3; 2026 3/3; 104 release outcomes.
- **TROW:** 217 F, 88 Q, 35 R (39.77%). F 2005–2026: 7,9,10,7,7,8,6,7,10,8,10,10,13,11,10,10,15,9,13,12,13,12.
  Q: 2004 1, 2005–2025 4 each, 2026 3. R in 2004–2026: 1,2,2,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,4,4,4,3; 35 release outcomes.
- **TPR:** 342 F, 88 Q, 86 R (97.73%). F 2005–2026: 17,12,10,14,9,8,13,13,16,19,20,17,26,20,14,24,18,12,19,17,14,10.
  Q/R: 4/4 in 2006–2009, 2012–2020, 2023–2025; 2005 5/5, 2010 3/2, 2011 5/5, 2021 3/2, 2022 5/5, 2026 3/3; 93 release outcomes.

Addendum SHA256 values: universe `fd38ac7e5ffff4260564ff1ee6b18adcb08942b102a2d1cf386a077975be9104`, filings
`a323526cb5a66484fede9f350a7ad1fd4c57536b4a4d8672623c3797cd4ad257`, quarters
`cb0a0ef27e3e553c6c4fed0c7709a7d65e2a6bd00dd242c4b524275be714bde0`, progress
`794bc796e3e7483aaa40fc672f8c85b9d1f0866319c70a4017013c3896a73c2e`, manifest
`03e243232b91775971a8d3ecd0147790895d118103dcff68f7425059d82375b4`. Files are under
`D:/research/alpha-engine/engine/events/` with the `*-six` names.

The original K06 files were re-hashed after collection and remain byte-identical: universe-rest
`f6d828f039078e5ea2c45af30a8092fc271522af523b8b97ef52c06eaece6fff`, filings-rest
`825193f90ef3cb8e3bbc38602d1ee5b052769fe8a5873dd71e59ec5a37d83427`, quarters-rest
`d36ec5cb90974a80601d728a0a320ae7fd4172a495b51718651f52fbca36ff29`, progress-rest
`755b0c578abe5c17cd18041d5c505f497b68a373f39fd8c7774e2545dfb62d91`, manifest-rest
`deddd1fca16c30a8981c188aef73a46bf00c6339e7945d2e46bfe609fe4e563f`.

### C. Empty daily-price files

The confirmed cause was the weekly refresh swapping the database without publishing its newly built artifact directory
to `prices/std`; this left stale files, not five broken Schwab CSV writers. Lab commits `c642be7` and `c656d5c` add
publication after a successful staged load, preserve the old directory under a versioned backup, restore it on copy
failure, and reject any header-only CSV when the company has first/last price dates. The explicit repair used:

```powershell
npx tsx C:/dev/alpha-engine-lab/src/prices/publish-std-build.mts D:/research/alpha-engine/prices/refresh-20261115T100457Z/std 20261116T140941Z
```

This is the source for the already loaded `p1.20261115` build. It published to `D:/research/alpha-engine/prices/std`
and preserved `std-backup-20261116T140941Z`. Source and loaded companies.json both hash to
`24241130c85325bec1b38b2ed79bb620c38b7ad873e9459db379fa20918d3dfc`. Only RIVN remained header-only immediately before
repair; the other four had been populated by an earlier refresh. All five are now verified against their live database
rows, with no numeric differences. Close hashes use `Number(value).toString()` normalization, avoiding decimal-text
format differences between CSV and MySQL.

| CIK | Ticker | Rows | First–last date | Close SHA256 |
| --- | --- | ---: | --- | --- |
| 1874178 | RIVN | 1,258 | 2021-11-10 – 2026-11-13 | `e6c6bd82d1445eb1dc16ecbfb41cc76823a0f0faac94479e694a8aa01af482b5` |
| 2058873 | Q | 260 | 2025-11-03 – 2026-11-13 | `84808b2968e812156fa36c04fdbe535ffff101846930896f5870fa2a9d1a30fb` |
| 2082247 | FDXF | 117 | 2026-06-01 – 2026-11-13 | `e2738870d3b2f27c530040856b1e52ca3edddfe104aff6d829cb552ed24182ee` |
| 2089271 | HONA | 98 | 2026-06-29 – 2026-11-13 | `4fb1380af4aba4c016a900e2db4dfb7c9c73daad867a2b1ff52ad0c980a5462e` |
| 2128626 | VYLR | 32 | 2026-10-01 – 2026-11-13 | `3b31efb43b24877940b9a4ecc0178bd65b15cb9ea7f3c63a786648d1fd430006` |

The regression test proves that the previous artifact is retained, new rows replace stale files, and a header-only
source fails without modifying the loaded artifact. No new rows needed database insertion: the loaded rows were already
present and correct.

### Verification

Passed: main `npm run check`; **259 test files / 1,446 tests**; `npm run build`; K18 **2 files / 10 tests**; K23
**1 file / 3 tests**; both standalone lab TypeScript configurations; `git diff --check` (only existing line-ending
warnings on unrelated files). The first attempted targeted command incorrectly looked for the lab config inside the lab
checkout; the same configs were then invoked from the main checkout, where they live, and all checks passed.

Main delivery includes the four collector commits `e6ebeb1`, `5fd8656`, `7742177`, `f1bf36d`, this report, the generated
six-company summary and handoff 188. Lab remains local at `c656d5c`. Unrelated generated reports, analytics snapshot,
`.vscode`, `desk-intraday-market.json` and `prediction-markets.json` are excluded.

Next: Claude updates the lab n1 company list from the corrected registry. K12 consumes K06 plus this six-company
addendum (452 companies). K20.1 must independently repair predecessor issuer history and weekend availability; neither
is part of K23.
