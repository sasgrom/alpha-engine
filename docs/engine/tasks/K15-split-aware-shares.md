# K15 — Share counts follow a split from its first session, not from the next filing

**Owner's approval:** 2026-11-13 ("K15 now, K16 after"). **Due:** before 2026-11-20 (SanDisk 8-for-1).
**Author of the spec:** Claude. **Coder:** Kimi. **Scope:** the main repository, application code and tests.

## 1. The problem

Market value is price × shares, and both must be on one share basis.

- **Prices:** the app's stored prices are on today's basis. Since 2026-11-13 the split watch (`worker/schwab-daily-bars.mts`,
  `basisChange` in `worker/lib/schwab-daily-bars.ts`) re-bases a company's whole stored history on the evening its new
  basis appears, and appends the event to `worker/.runs/price-adjustments.jsonl`.
- **Shares:** `api/services/split-shares.ts` puts filed share counts on today's basis with `applySplitEvents`: a count filed
  before an event's `firstNewBasisFiled` is multiplied by the event's ratio. Events come only from SEC facts
  (`buildSplitProfile`), so the app learns a split only when a filing on the new basis exists, usually the next 10-Q,
  up to three months later.

Between the split's first session and that filing, every stored price is on the new basis and every share count on the
old one. Every market value of the company, history included, is off by the split ratio. That affects market value,
valuation factors, the screener and every other consumer of `createSplitShareProvider`.

SanDisk (SNDK, CIK 2023554) splits 8-for-1 on 2026-11-20 (Yahoo's split calendar, `D:\research\alpha-engine\prices\split-calendar\latest.json`). Without
K15 its market value would read one eighth of the truth from that evening until about February 2027.

## 2. What to build

Split events learned from the split watch, used until the filings show the split.

1. **Read the log** `worker/.runs/price-adjustments.jsonl` (one JSON object per line, written by `schwab-daily-bars.mts`):
   - `priceKey`: the company's CIK in `prices`; `ticker`;
   - `ratio`: new close ÷ old close (0.125 for an 8-for-1 split; 8 for a 1-for-8 reverse split);
   - `firstNewBasisDate`: the first session on the new basis; `dates`, `detectedAt`, `rebased`;
   - `dryRun`: true when nothing was re-based.
   A missing file, an empty file or a malformed line must not break anything (skip the line and count it).
2. **Turn entries into split events:**
   - Ignore `dryRun: true` entries.
   - The split ratio is `1 / ratio`. Snap it with `nearestSplitRatio` (1% tolerance); an entry whose factor is not a
     split ratio is a price-only adjustment (Schwab applies some spin-offs to the whole history, for example 1.28) and
     changes no share count. Ignore it for shares, but report it in the provider's diagnostics.
   - The same event logged twice (two runs) counts once: key `(priceKey, firstNewBasisDate, snapped ratio)`.
   - Such an event behaves like an SEC event whose `firstNewBasisFiled` is the `firstNewBasisDate`: a share count filed
     before that date is multiplied by the ratio, one filed on or after it is not.
     Mark it so it can be told apart, for example `source: "price"`, with the ex-date kept.
3. **Merge with the SEC events.** An SEC-detected event with the same snapped ratio whose `firstNewBasisFiled` lies between
   30 days before and 200 days after the price event's `firstNewBasisDate` is the same split.
   - Then the SEC event wins: it is derived from the filed numbers and may place the boundary differently. For example, A. O.
     Smith's 10-Q of 2013 already showed the new basis before the ex-date.
   - The price event is dropped, so nothing is applied twice.
   - Without a matching SEC event, the price event stands in.
   - Events stay sorted by their boundary date.
4. **Where:** in `createSplitShareProvider` (or a small helper it calls), so every consumer gets the same events.
   - Keep `buildSplitProfile` pure; pass the price events in.
   - Read the log once per process and again when its modification time changes; no new database table, no schema change.
   - The path is relative to the repository root, as other worker outputs are read.

## 3. Rules

- No schema changes, no production writes or pushes (owner, 2026-11-13), nothing in `api/lib/` or `api/kimi/`, no `.env`.
- Do not change the split watch itself or the price data. This task only reads the log.
- English names, comments and test names.
- Keep every existing test green; existing behaviour without a log must be byte-for-byte the same.

## 4. Acceptance checks

Unit tests (in `api/services/split-shares.test.ts` or a new test file next to it):

1. A price event alone (8-for-1 on 2026-11-20): a count filed 2026-11-05 is multiplied by 8; one filed 2026-11-25 is not.
2. A price event plus an SEC event with the same ratio filed 2027-02-03: one application only, the SEC event's boundary.
3. A price event plus an SEC event with another ratio, or more than 200 days later: both stand, as separate splits.
4. A reverse split (`ratio` 8 in the log, 1-for-8): counts filed before are multiplied by 0.125.
5. A non-split adjustment (`ratio` 1/1.28): no share change, listed in diagnostics.
6. `dryRun: true` entries, duplicate lines and a malformed line: ignored as described; a missing log changes nothing.
7. A market-value case through the provider (or `market-value.ts`):
   - setup: SNDK-like, price re-based ×0.125 before 2026-11-20, the last 10-Q's shares on the old basis;
   - expected: market value continuous across 2026-11-20 and equal to the pre-split value on 2026-11-19 (within rounding).

Gates before the commit (AGENTS.md section 5):
- `npm run check`;
- `npm test -- --run`;
- `npm run build`;
- `git diff --check`.

Claude runs no main-repository tests or builds while K15 is open. Send a mailbox note before the full test run anyway.

## 5. Delivery

- One commit in the main repository with code, tests and a handoff section. Push it as a fast-forward when `main` is ahead of
  `origin/main` only by your commit, and say so. If anything else is ahead, leave the push to Claude.
- Do not restart the web server: Claude restarts it after the review.
- A mailbox message to `to-claude/` with:
  - the commit;
  - the test names and counts;
  - the gate results;
  - the diagnostics of a dry read of the real log (it may be empty until the first real split).

## 6. Out of scope

- The upcoming-split calendar: no share change before the split happens.
- Historical splits before 2026-11-13: the SEC detection already covers them.
- Splits of companies outside `prices`.
- Changing how share counts are chosen (`selectShareCount`).
