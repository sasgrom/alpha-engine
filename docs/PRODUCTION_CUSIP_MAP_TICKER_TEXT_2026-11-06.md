# OpenFIGI ticker preservation and `cusip_map.ticker` TEXT migration

Date: 2026-11-06
Status: **local MySQL migration verified; production migration not applied**

## 1. Why the label exists

`cusip_map.cusip` is the primary identifier. `ticker` is a nullable provider attribute used by the 13F refresh to resolve an instrument to a company CIK through an exact `companies.ticker` match. It is not a unique key and there is no ticker index on `cusip_map`.

OpenFIGI can return more than an exchange symbol: bond and option labels may include coupon, maturity and other instrument details. These values are useful metadata, but they must not be mistaken for an equity ticker. SEC information-table XML remains the primary 13F evidence and is not replaced by OpenFIGI metadata.

The original MySQL definition was `ticker VARCHAR(20) NULL`. A real provider result for CUSIP `31816QAD3` was `MNDT 1.625 06/01/35 B`, 21 characters, causing `ER_DATA_TOO_LONG` (1406, SQLSTATE 22001) and leaving quarters open. Truncating the label would corrupt the mapping key; silently discarding it would lose provider metadata.

## 2. Length evidence and type decision

The official [OpenFIGI API documentation](https://www.openfigi.com/api/documentation) describes `ticker` as an instrument attribute but does not specify a maximum length.

A bounded read-only diagnostic sampled 67 existing CUSIPs and returned 768 instrument entries. Observed ticker lengths were 3–21 characters: one value over 20, none over 50, 100 or 255. This is not proof of a provider-wide maximum.

The column is **TEXT** rather than another arbitrary VARCHAR cap:

- there is no ticker index to resize;
- all nonempty provider labels can be preserved without truncation;
- CUSIP identity and exact ticker-to-company matching are unchanged;
- `information_schema` reports `DATA_TYPE=text` and `CHARACTER_MAXIMUM_LENGTH=65535` after the migration.

`normalizeFigiTicker` now trims valid strings and returns null only for empty or non-string values. It preserves the full 21-character bond descriptor. Widening the column does not map a bond to an equity issuer and does not add filtered `fund_holdings` rows automatically.

## 3. Backup before the local ALTER

The first backup attempt encountered `ER_ACCESS_DENIED_ERROR`; no backup or ALTER was performed. A separate `mysqld` process was then confirmed active and a fresh `SELECT 1` passed before the successful backup. No credentials were read, printed or changed. The existing configured environment was used; no login parameters were exchanged in chat.

Backup directory: `worker/.runs/cusip-map-ticker-text-20261106-reviewed`

- `backup-cusip-map.json`: 32,440 rows, 5,609,978 bytes.
- Backup SHA256: `02350eade8542c6f90b13bd5ccf5d083c74d8b2706f377712549be1ceb2d0201`.
- Pre-migration table fingerprint: `b077dec436cb4dd926063e4129a995bf3a36e8c66d3cc2c4ddabeb802e14219b`.
- Original type: `varchar(20)`.
- Backup rows, bytes and SHA256 were independently re-read and verified before the ALTER.
- No 13F refresh process was active during the schema apply.

## 4. Local change actually executed

```sql
ALTER TABLE cusip_map MODIFY COLUMN ticker TEXT NULL;
```

Files:

- `db/ddl/030_cusip_map_ticker_text.sql`
- `apply-ddl-030.mts`
- `scripts/backup-cusip-map.mts`
- `worker/lib/apply-ddl-030.test.ts`
- `db/schema.ts`
- `worker/lib/figi.ts` and `worker/lib/figi.test.ts`
- `scripts/13f-refresh.mts`

The applier accepts only this one statement, verifies backup integrity and current row count, checks the pre-migration table fingerprint, and skips when the column is already TEXT. It does not recreate the table, drop objects, delete rows or print credentials/full DDL.

## 5. Verified result

- `ticker` is `TEXT`; only the primary CUSIP index remains.
- Row count before and after: **32,440**.
- Ordered row-payload SHA256 before and after is identical: `02350eade8542c6f90b13bd5ccf5d083c74d8b2706f377712549be1ceb2d0201`.
- Post-migration table fingerprint: `a3dd52791a83f736503418c1240acd8e285b9fad89569c3877ce3b4711b4bcb0`.
- Repeating the applier produced `step 1/1: ticker already uses TEXT; skipping`, not another ALTER.
- Targeted applier and FIGI tests: **2 files / 12 tests passed**.
- Full regression suite: **138 files / 763 tests passed**.
- TypeScript check, production build and `git diff --check` passed.

The migration changed the column type only; no source rows were edited by it. The unchanged row-payload hash proves that no history was overwritten.

## 6. Important remaining limitation

A schema change cannot reconstruct a provider label that was previously replaced by null. `shouldRequestCusip` retries cached negative results only in explicit `--repair` mode. Therefore a normal refresh will preserve new long labels, but it will not reconstruct all labels discarded by the earlier temporary normalization. A repair/re-fetch is a separate owner decision and was not run here.

The full 24-quarter collector was stopped at the owner's request and was not restarted by this migration block. The user can rerun it after reviewing the code. No production sync or deployment is implied.

## 7. Production-agent handoff — do not apply automatically

The production agent must treat this as a separately reviewed migration, not as a completed production change.

1. Pull the reviewed source and this document. Do not use chat-transferred credentials.
2. Confirm the intended production database, current schema and no active 13F collector.
3. Create and independently verify a complete `cusip_map` backup before any ALTER:

   ```powershell
   npx tsx scripts/backup-cusip-map.mts --out worker/.runs/cusip-map-ticker-text-<utc-timestamp>
   ```

4. Confirm the backup row count, file bytes, SHA256 and `SHOW CREATE TABLE` fingerprint. Do not proceed if they differ from the actual production table.
5. Apply only the reviewed statement through the guarded applier:

   ```powershell
   npx tsx apply-ddl-030.mts --backup-manifest worker/.runs/cusip-map-ticker-text-<utc-timestamp>/backup-manifest.json
   ```

6. Verify `DATA_TYPE=text`, unchanged row count, unchanged ordered row-payload hash and no new ticker index. A repeat apply must skip safely.
7. Record the production backup/hash evidence separately. Do not run `db:push`, DROP, TRUNCATE, table replacement or automatic deployment.
8. Treat any repair of previously discarded labels as a separate reviewed action, not as part of this DDL.

No production backup, production ALTER, production apply or production deployment was performed by this work block.
