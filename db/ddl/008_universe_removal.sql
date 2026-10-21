-- ============================================================================
-- DDL 008 — Iteration 4b: universe removal (view-level) + action log (D29)
-- Applied manually (apply-ddl-008.mts), idempotent, no DROP / no --force.
--
--   1. companies += removedAt timestamp NULL — when set, the company is
--      hidden from the universe view (the DB is shared: the removal is
--      global view-level state, not per-user). The company row and ALL
--      accumulated data (filings, facts, series, sections, scores, prices,
--      events) stay untouched; inUniverse is NOT modified either (removal
--      requires the company to be inactive first). Restore path: search
--      the ticker in the Universe table → the REMOVED row offers restore.
--      Re-ingesting the ticker clears the removal automatically (upsert).
--
--   2. companies += removedBy bigint unsigned NULL — users.id of whoever
--      removed it (shown in the REMOVED row tooltip).
--
--   3. jobs.type enum += 'universe-remove','universe-restore' — every
--      removal/restore is recorded as a terminal micro-job row
--      (startedBy = the acting user) with job_logs lines carrying the
--      who/what/when meta. Visible on the Jobs page and in Admin → Logs.
-- ============================================================================

ALTER TABLE `companies` ADD COLUMN `removedAt` timestamp NULL AFTER `inUniverse`;
ALTER TABLE `companies` ADD COLUMN `removedBy` bigint unsigned NULL AFTER `removedAt`;

ALTER TABLE `jobs` MODIFY COLUMN `type`
  enum('bootstrap','filings','stream','facts','harvest','series','sections','score','prices','universe-remove','universe-restore')
  NOT NULL;
