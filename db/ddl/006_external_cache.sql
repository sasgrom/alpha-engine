-- ============================================================================
-- DDL 006 — Iteration 3l: DB-backed cache for slow external payloads (D27)
-- Applied manually (apply-ddl-006.mts), idempotent, no DROP / no --force.
--
-- Owner principle (2026-10-12): "fetched/computed once → stored in the DB →
-- nobody waits for a refetch". The Universe page hit Wikipedia (index
-- constituents) and SEC (12k-row company directory) on every cold process;
-- those payloads are small and slow-moving, so they now persist here with
-- stale-while-revalidate semantics (services/ext-cache.ts).
--
--   external_cache(key PK, payload MEDIUMTEXT JSON, fetchedAt, source)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `external_cache` (
  `key` varchar(64) NOT NULL,
  `payload` mediumtext NOT NULL,     -- JSON-serialized payload
  `fetchedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source` varchar(24) NOT NULL,     -- live | snapshot (fallback origin marker)
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
