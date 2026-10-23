-- DDL 020 (5e): daily digest store — LLM-written morning briefs built from
-- the last-day signals (edgar notes, stocktwits crowd reads). Upsert by
-- (kind, forDate): re-digesting a date REFRESHES the row (honest: the digest
-- is derived, not a source; the inputs keep their own lineage).
CREATE TABLE IF NOT EXISTS `digests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `kind` varchar(24) NOT NULL DEFAULT 'morning',
  `forDate` date NOT NULL,
  `body` text NOT NULL,
  `model` varchar(64) NULL,
  `meta` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_digests` (`kind`, `forDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
