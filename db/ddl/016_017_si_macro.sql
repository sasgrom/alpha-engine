-- ============================================================================
-- DDL 016/017 — Iteration 4m: short interest + macro points (D46)
-- Applied manually (apply-ddl-016.mts), idempotent, no DROP / no --force.
--
-- short_interest: settlement-dated rows. Sources: 'yahoo_gw' (Yahoo via the
-- agent gateway — settlement-date fields incl. prior month) now;
-- 'finra' biweekly files when the worker picks them up.
--
-- macro_points: FRED observations carry the plugin's realtime_start/
-- realtime_end columns — vintage-aware by construction (D2 discipline for
-- macro: a value is valid only within its realtime window).
-- ============================================================================

CREATE TABLE IF NOT EXISTS `short_interest` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `settlementDate` date NOT NULL,
  `sharesShort` bigint NULL,
  `shortRatio` double NULL,            -- days-to-cover
  `shortPercentOfFloat` double NULL,   -- 0.0083 = 0.83%
  `source` varchar(24) NOT NULL,       -- yahoo_gw | finra
  `fetchedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_short_interest` (`cik`, `settlementDate`, `source`),
  KEY `idx_si_cik_date` (`cik`, `settlementDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `macro_points` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `seriesId` varchar(32) NOT NULL,     -- FRED series id (DGS10, FEDFUNDS…)
  `date` date NOT NULL,
  `value` double NULL,                 -- NULL = FRED's "." missing marker
  `realtimeStart` date NULL,
  `realtimeEnd` date NULL,             -- vintage window (FRED realtime columns)
  `fetchedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_macro_points` (`seriesId`, `date`, `realtimeStart`),
  KEY `idx_macro_series_date` (`seriesId`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
