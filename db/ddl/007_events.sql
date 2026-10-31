-- ============================================================================
-- DDL 007 — Iteration 4a: 8-K items + corporate event stream (D28)
-- Applied manually (apply-ddl-007.mts), idempotent, no DROP / no --force.
--
--   1. filings += items varchar(200) NULL — the 8-K item list from the SEC
--      submissions API (e.g. "2.02,9.01"). NULL for rows ingested before
--      this column existed; refreshed on the next filings/bootstrap pass.
--
--   2. NEW TABLE events — materialized corporate events derived from our
--      own data (no external calendar needed). v1 type: 'earnings'
--      (8-K Item 2.02 = results of operations). Point-in-time by
--      construction: filingDate is when the event became public.
-- ============================================================================

ALTER TABLE `filings` ADD COLUMN IF NOT EXISTS `items` varchar(200) NULL AFTER `primaryDoc`;

CREATE TABLE IF NOT EXISTS `events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `type` varchar(24) NOT NULL,       -- v1: 'earnings'
  `eventDate` date NOT NULL,         -- reportDate when known, else filingDate
  `filingDate` date NULL,            -- when it became public (no-lookahead)
  `accessionNo` varchar(25) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_events` (`cik`, `type`, `accessionNo`),
  KEY `idx_events_cik_date` (`cik`, `eventDate`),
  KEY `idx_events_date` (`eventDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
