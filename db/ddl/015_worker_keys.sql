-- ============================================================================
-- DDL 015 — Iteration 4k: worker_keys (D45) — the table iteration 2
-- announced but never created (found empty in prod 2026-10-20).
-- The home worker authenticates with a Bearer key; we store only its SHA-256.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `worker_keys` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `keyHash` varchar(64) NOT NULL,      -- sha256 hex of the key — never the key
  `label` varchar(64) NOT NULL,        -- "mac-studio" etc.
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastUsedAt` timestamp NULL,
  `revokedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_worker_keys_hash` (`keyHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
