-- DDL 023 (5f+): options in 13F (secClass on holdings; UQ widened — a PUT and
-- the underlying share one cusip in one quarter) + FIGI metadata on the
-- crosswalk (exchCode, secType — free in the same mapping response).
ALTER TABLE `fund_holdings` ADD COLUMN `secClass` varchar(12) NOT NULL DEFAULT 'COM' AFTER `cusip`;
ALTER TABLE `fund_holdings` DROP INDEX `uq_fund_holding`;
ALTER TABLE `fund_holdings` ADD UNIQUE KEY `uq_fund_holding` (`fundCik`, `cusip`, `secClass`, `quarterDate`);

ALTER TABLE `cusip_map` ADD COLUMN `exchCode` varchar(16) NULL;
ALTER TABLE `cusip_map` ADD COLUMN `secType` varchar(48) NULL;
