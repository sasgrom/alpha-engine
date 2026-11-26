# K31 — Russell 1000 price panel for return tests

Task for Kimi Code. **Owner's go of 2026-11-26** ("load him more"; the Russell tone test runs "after Kimi's prices").
Written by Claude the same day. Kimi's credits end 2026-11-30 16:00. Write the code and tests now, beside the K27
collectors; run it when K27 parts D and E are complete.

## Goal

The same test bed Claude's S&P 500 tests use (the fable1 panel, `D:/research/alpha-engine/engine/fable1/data/px.npz`,
`member.npz`, `entities.json`, built by lab `src/research/fable1/univ_build.py`), for the Russell 1000 by date:
total-return opens and closes and point-in-time membership, so that any return test runs on either universe unchanged.

## Build (lab, new folder `src/research/r1000/`, Kimi's own path)

1. **Entities:** every K26 company (active, former-listed, former-gone) with `id` (CIK as text), `cik`, `ticker`,
   `name`, `sector` (K26's SIC map; null where unmapped), `inSp500Panel` (whether fable1 has it), `priceSource`,
   `first`, `last`.
2. **Prices:** daily total-return close (TRC) and open (TRO), close and volume, on the standard session calendar
   (`D:/research/alpha-engine/prices/std/sessions.json`):
   - companies already in the fable1 panel: copy fable1's series unchanged;
   - the others: K27 D's Schwab history (split-adjusted) with K27 E's Yahoo cash dividends added back as reinvested
     total return (ex-date at the open); Stooq's adjusted series where E found it, as a check only.
3. **Membership:** K26's members by report date, a member at session t = held in the latest report on or before t (the
   same conservative rule as `sp500-membership.json`), and its weight (K26's value share).
4. **Output** `D:/research/alpha-engine/engine/r1000-panel/<build stamp>/` with `px.npz`, `member.npz`,
   `entities.json` in fable1's array layout (dates × ids), a manifest (inputs and their hashes, code commit, counts)
   and `gates.json`. Never overwrite a build; new stamp each time.

## Gates (report the numbers whether they pass or not)

1. Overlap: for companies in both panels, daily TRC returns equal fable1's (median absolute difference below 1 bp, the
   share of days over 5 bp listed).
2. Splits: every Yahoo split in E shows as no jump in TRC (and as a jump of the ratio in the unadjusted close, if D
   keeps it). List each disagreement.
3. Stooq check where available: median absolute daily difference in total return; companies over 5 bp listed.
4. Coverage: per company first and last price, gaps against the session calendar, jumps over 25% in a day listed for
   review; members without prices (weight share by quarter).
5. Membership weights sum to 1 per report; the count per report against K26's matched lines.

## Rules

AGENTS.md in full. No database write, no change to fable1's files or to the main repo's code. Python with numpy and
pandas (installed). Tests for the total-return arithmetic (dividend at ex-date, split day) with tiny fixtures. Deliver
a report at the end of this file, a handoff section and a mailbox message to Claude.
