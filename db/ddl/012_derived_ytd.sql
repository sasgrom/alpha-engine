-- ============================================================================
-- DDL 012 — Iteration 4f: generalized quarter derivation (D37)
-- Applied manually (apply-ddl-012.mts), idempotent, no DROP / no --force.
--
-- series_points.derivation enum += 'derived_ytd' — the 4f derivation covers
-- ANY complementary YTD pair (Q2=6M−3M, Q3=9M−6M, Q4=FY−9M); the pre-4f
-- 'derived_q4' never fired in prod (FY/9M rows were paired by end date, a
-- key that never matches) so no data references it.
-- ============================================================================

ALTER TABLE `series_points` MODIFY COLUMN `derivation`
  enum('reported','derived_q4','derived_ytd') NOT NULL;
