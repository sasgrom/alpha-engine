# K26 — Russell 1000 membership, point in time, and the new companies' identities

Task for Kimi Code. **Owner's go of 2026-11-25** ("go with task pipeline for kimi", for the Russell 1000 as a research
universe). Written by Claude the same day. First of three: K26 → K27 (raw data) → K28 (release figures). Kimi's credits
end 2026-11-30 16:00: work in checkpointed steps and report after each one, so Claude can finish whatever is left.

## Why

The engine has only seen the S&P 500 (our 502-company registry), and nothing public beat the index there. The next 500
companies by size are followed by fewer analysts, and a pooled engine gains power from more companies. This task
builds who was a member of the Russell 1000 at each quarter end since 2019, with the new companies' identities, so
K27 can collect their data. Survivorship matters: former members must be included, exactly as for the S&P 500 (memory
of 2026-11-16: today's members alone made a technical model look like +11.7%/yr instead of +4.3%).

## Method (as for the S&P 500 membership of 2026-11-16)

1. **Source:** the SEC N-PORT-P reports of the **iShares Russell 1000 ETF (IWB)**. Find its CIK and series ID in the
   SEC's `company_tickers_mf.json`; take every quarter-end report from 2019-09-30 to the newest one public. **Second
   source for the cross-check:** the Vanguard Russell 1000 Index Fund (VRNIX), found the same way.
2. **Fetch** with the project's SEC client `secGet` (`worker/lib/edgar.ts`: declared identity, at most 7 requests a
   second). Raw XML unchanged, with a manifest (accession, report date, bytes, SHA-256), under
   `D:/research/alpha-engine/index-membership/nport/<series id>/`. An existing file is a completed checkpoint.
3. **Parse** the equity holdings of each report: name, CUSIP, ISIN, other identifiers, shares, value, percent of net
   assets. Leave out cash, futures, money-market funds and other non-equity lines, and list what was left out per
   report.
4. **Match each holding to a SEC CIK,** in this order: CUSIP via the 13F CUSIP map (read-only:
   `alpha_research.std_13f_*` and Claude's `D:/research/alpha-engine/index-membership/cusip-company-map.json`); then
   exact normalized name against SEC current and former names (`company_tickers.json` and the submissions JSON; cache
   new ones under `D:/research/alpha-engine/engine/events/sec-submissions/`). Two share classes of one company (GOOG and
   GOOGL, BRK.A and BRK.B, FOX and FOXA, NWS and NWSA) are one company with several lines. **Never guess:** a holding
   without a certain match goes to the unmatched list with its name, CUSIP and weight.
5. **Membership rule:** a company is a member at date t if it is held in the latest IWB report on or before t. That is
   conservative by up to one quarter for new joiners; write the rule into the output.
6. **Identity of each company in the union:** CIK, current ticker(s), current SEC name and former names, SIC code,
   state of incorporation, first and last quarter as a member, active (in the newest report) or former, and whether it
   is in our 502-company registry (`alpha_engine.companies`, read-only).
7. **Sector:** our registry uses the 11 GICS sectors, which are not public for these companies. Build a documented
   SIC → sector map. **Validate it on our 502 companies:** the share whose SIC-mapped sector equals their registry
   sector, and the confusion table. Mark each new company's sector with `sectorSource: "sic-map"`. Our 502 keep their
   registry sector.

## Outputs (new files only; nothing existing is edited)

Under `D:/research/alpha-engine/index-membership/russell1000/`:
- `holdings-<series>.json`: parsed equity lines per report, for IWB and VRNIX.
- `membership.json`: per quarter end, the members (CIK, lines, weight), plus the rule, the source accessions and their
  hashes.
- `companies.json`: the union with the identity of step 6 and the sector of step 7.
- `unmatched.json`, `sector-map.json` (the map and its validation), `build.json` (code commit, inputs with hashes,
  counts, gate results).

In the main repo (committed): the collector universes for K27, in the format of `worker/edgar-universe.json`:
- `worker/edgar-universe-r1000-new.json`: active members not in our registry.
- `worker/edgar-universe-r1000-former.json`: former members not in our registry.

The code goes in the main repo under `scripts/` or `worker/` with tests (fixtures: a cut-down N-PORT XML; the matching
rules; the share-class merge; the membership rule).

## Gates (all must pass; report the numbers whether they pass or not)

1. **Coverage:** every quarter end from 2019-09-30 to the newest report is present for IWB (and for VRNIX where it
   exists), or the gap is listed with the SEC's own answer.
2. **Size:** the index has about 1,000 members (it varies by year). Expect 950 to 1,060 equity lines per report and
   slightly fewer companies after merging share classes. Report the count of every quarter, and the reason for any
   quarter outside that range.
3. **Matching:** at least 99.5% of each report's equity weight is matched to a CIK, and the unmatched lines are listed.
4. **Cross-check:** IWB and VRNIX agree on membership for at least 98% of companies per common quarter; every
   disagreement is listed with both weights (small names near the cut are expected).
5. **Consistency with the S&P 500 membership** (`D:/research/alpha-engine/index-membership/sp500-membership.json`): at
   each common quarter end, at least 97% of the S&P 500 members are Russell 1000 members; list the others.
6. **Known cases:** our 502 that are current Russell members (expect almost all); one recent IPO joiner (for example
   ARM or CAVA) appears in the first report after its index addition; one company that left by merger or a fall in
   size appears until then and is marked former.
7. **Sector map validation** on our 502: report the agreement share. It is not a pass or fail gate, but the number goes
   into `sector-map.json`.

## Rules

- AGENTS.md applies in full. Read-only on `alpha_engine` and `alpha_research`. No writes to either database, no schema
  change, no change to the app's company registry, no scheduler change, no production write.
- SEC only, through `secGet`. No other source and no web scraping.
- D: protocol of AGENTS.md section 3.1: raw files and outputs on D:, checkpoints, no C: fallback.
- **Own paths only:** never edit a file that Claude's work holds. Before any full test run, build, web or scheduler
  restart, write to Claude's mailbox first. Claude commits only its own paths and will not touch yours.
- English in code, tests and docs.

## Delivery

A delivery report at the end of this file (gate numbers, counts, the unmatched list's size and weight, and anything
surprising), a handoff section, and a mailbox message to Claude (`worker/.runs/bridge/to-claude/`). Commit and push
source, tests, the universe files and the docs after `npm run check`, the targeted tests, `npm test -- --run`,
`npm run build` and `git diff --check`. Then start K27 if the owner approved it.
