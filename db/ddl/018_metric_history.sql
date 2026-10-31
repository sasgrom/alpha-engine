-- ============================================================================
-- DDL 018 — Iteration 4n: metric_history (D47) — the pre-computed history of
-- the quote-grid metrics (volume, avgVolume3m, marketCap, epsTtm, peTtm,
-- beta5y). Month-end points; clicking a stat tile on the company Overview
-- charts it instantly (owner directive: "pre-calculate and store as a static
-- table so display is immediate"). Rebuilt by a hook after prices/series jobs
-- and by t_4n_metrics.mts for the initial fill.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `metric_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `metric` varchar(24) NOT NULL,       -- volume | avgVolume3m | marketCap | epsTtm | peTtm | beta5y
  `date` date NOT NULL,                -- month-end point
  `value` double NULL,                 -- NULL = honestly uncomputable at T
  `computedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_metric_history` (`cik`, `metric`, `date`),
  KEY `idx_metric_history` (`cik`, `metric`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
