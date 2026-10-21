-- ============================================================================
-- DDL 005 — Iteration 3f: historical daily price bars (Stage 1.7)
-- Applied manually (apply-ddl-005.mts), idempotent, no DROP / no --force.
--
--   1. NEW TABLE prices — end-of-day OHLCV bars from free providers
--      (Stooq primary, Yahoo chart API fallback). One row per
--      (cik, date, source): bars from different providers coexist and are
--      comparable — the `source` column IS part of the identity, because
--      two free feeds legitimately disagree (adjustment policy, halts).
--      cik = 0 is reserved for benchmark pseudo-entities (SPY), which have
--      no SEC company row.
--
--   2. jobs.type enum += 'prices' — the price sync job type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `prices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,                -- 0 = benchmark pseudo-entity (e.g. SPY)
  `ticker` varchar(20) NOT NULL,     -- ticker AS FETCHED (kept for audit; tickers change, cik does not)
  `date` date NOT NULL,
  `open` double NULL,
  `high` double NULL,
  `low` double NULL,
  `close` double NULL,
  `adjClose` double NULL,            -- split/dividend-adjusted close (stooq: = close, already adjusted)
  `volume` bigint NULL,
  `source` varchar(16) NOT NULL,     -- stooq | yahoo | test
  `fetchedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prices_bar` (`cik`, `date`, `source`),
  KEY `idx_prices_cik_date` (`cik`, `date`),
  KEY `idx_prices_ticker` (`ticker`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `jobs` MODIFY COLUMN `type`
  ENUM('bootstrap','filings','stream','facts','harvest','series','sections','score','prices') NOT NULL;
