-- ============================================================================
-- DDL 004 — Iteration 3c: jobs.startedBy (per-user job visibility)
-- Applied manually (apply-ddl-004.mts), idempotent, no DROP / no --force.
--   1. jobs += startedBy BIGINT UNSIGNED NULL — users.id of the job launcher.
--      NULL = legacy rows; visible to admins only.
-- ============================================================================
ALTER TABLE `jobs` ADD COLUMN `startedBy` bigint unsigned NULL;
