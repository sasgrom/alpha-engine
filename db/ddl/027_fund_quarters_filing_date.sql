-- DDL 027 (13F point-in-time): latest amendment availability per fund-quarter.
-- Nullable for historical rows until --totals-only backfills actual SEC dates.
ALTER TABLE `fund_quarters` ADD COLUMN `filingDate` datetime NULL AFTER `quarterDate`;
