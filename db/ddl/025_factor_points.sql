-- DDL 025 (6a): factor_points — factor values per company per period, anchored
-- on the LATEST sourceFiled of the underlying concepts (availability date, the
-- no-lookahead anchor). periodEnd is the economic period; filedAt is when we
-- could know it. Recompute is idempotent (upsert by UQ).
CREATE TABLE IF NOT EXISTS `factor_points` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `factor` varchar(40) NOT NULL,
  `periodEnd` date NOT NULL,
  `filedAt` datetime NOT NULL,
  `value` double NULL,
  `computedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_factor_points` (`cik`, `factor`, `periodEnd`),
  KEY `idx_fp_factor` (`factor`, `periodEnd`),
  KEY `idx_fp_cik` (`cik`, `periodEnd`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
