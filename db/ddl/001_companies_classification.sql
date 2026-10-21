-- ============================================================================
-- DDL 001 — Iteration 3a (Stage 2 / scope presets)
-- ----------------------------------------------------------------------------
-- companies += sector / industry (GICS, from the Wikipedia S&P 500 table).
-- Applied MANUALLY via a tsx runner script (drizzle-kit push needs an
-- interactive TTY and is unusable in this environment — see manual §ops).
-- NEVER run with --force semantics; this statement is purely additive.
-- Idempotency: guarded by information_schema check in apply-ddl.mts.
-- ============================================================================
ALTER TABLE `companies`
  ADD COLUMN `sector` varchar(100) NULL AFTER `fiscalYearEnd`,
  ADD COLUMN `industry` varchar(160) NULL AFTER `sector`;

CREATE INDEX `idx_companies_sector` ON `companies` (`sector`);
