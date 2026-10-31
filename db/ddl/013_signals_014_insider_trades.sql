-- ============================================================================
-- DDL 013 — Iteration 4i: signals feature store (D43, schema only)
-- DDL 014 — Iteration 4i: insider trades (D42, schema only)
-- Applied manually (apply-ddl-013.mts), idempotent, no DROP / no --force.
-- BOTH tables are coded now and populated by the LOCAL WORKER later
-- (owner directive: no cloud credit burn on heavy pulls).
--
-- signals: every signal carries BOTH timestamps — eventTs (content time) and
-- ingestedAt (arrival). Backtests read ingestedAt ≤ T only; backfills are
-- marked src='backfill' and used by eventTs under an explicit research flag.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `signals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `source` varchar(24) NOT NULL,      -- gdelt | stocktwits | reddit | youtube | trends
  `signalType` varchar(24) NOT NULL,  -- tone | buzz | label
  `eventTs` datetime NOT NULL,        -- when the CONTENT was published
  `ingestedAt` datetime NOT NULL,     -- when it reached US (no-lookahead anchor)
  `score` double NULL,                -- tone/sentiment −1..+1 when applicable
  `magnitude` double NULL,            -- intensity (mention count, labeled share…)
  `payloadKey` varchar(255) NULL,     -- object-storage key for the raw payload
  `src` varchar(24) NOT NULL DEFAULT 'live',  -- live | backfill
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_signals` (`cik`, `source`, `signalType`, `eventTs`),
  KEY `idx_signals_cik_ingested` (`cik`, `ingestedAt`),
  KEY `idx_signals_eventts` (`eventTs`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `insider_trades` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `accessionNo` varchar(25) NOT NULL,
  `insiderName` varchar(255) NULL,
  `insiderRole` varchar(64) NULL,     -- CEO/CFO/Director/10% owner…
  `code` varchar(2) NOT NULL,         -- P purchase, S sale, A grant, M exercise, F tax, G gift
  `shares` double NULL,
  `price` double NULL,
  `sharesAfter` double NULL,
  `tradeDate` date NULL,
  `filingDate` date NOT NULL,         -- point-in-time anchor
  `is10b5` tinyint(1) NOT NULL DEFAULT 0,  -- Rule 10b5-1 plan checkbox (2023+ XML)
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_insider_trades` (`cik`, `accessionNo`, `code`, `shares`),
  KEY `idx_insider_cik_date` (`cik`, `tradeDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
