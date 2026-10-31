-- DDL 021 (5e): digests.scope — company-quarter briefs share forDate across
-- tickers, so (kind, forDate) alone collides; scope carries the ticker
-- ('' for universe-wide kinds like "morning").
ALTER TABLE `digests` ADD COLUMN `scope` varchar(32) NOT NULL DEFAULT '' AFTER `kind`;
ALTER TABLE `digests` DROP INDEX `uq_digests`;
ALTER TABLE `digests` ADD UNIQUE KEY `uq_digests` (`kind`, `scope`, `forDate`);
