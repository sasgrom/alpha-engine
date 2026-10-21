-- ============================================================================
-- DDL 009 — Iteration 4c: per-user universes + admin↔user chat (D30/D31/D32)
-- Applied manually (apply-ddl-009.mts), idempotent, no DROP / no --force.
--
--   1. NEW TABLE user_universe — the per-user universe (D30). One row per
--      (userId, cik) membership; active=false is the "hidden" state (the
--      switch), row deletion is the trash can. ticker/name are denormalized
--      so the row displays before the auto-ingest finishes. The shared
--      companies table is never touched by membership actions.
--
--   2. NEW TABLE messages — one private thread per user with the admin
--      (D32). threadUserId = the non-admin user who owns the thread;
--      isAdminMsg distinguishes the admin's replies.
--
--   3. jobs.type enum += 'universe-add' — add/remove are logged as terminal
--      micro-jobs (D29 machinery kept); 'universe-restore' is deprecated
--      (removal is a plain row delete now, re-add = universe-add).
--
--   4. MIGRATION: every EXISTING user starts with a copy of the legacy global
--      universe (they were all sharing it); brand-new users start empty.
--      companies.inUniverse / removedAt / removedBy stay in the DB untouched
--      (deprecated in code).
-- ============================================================================

CREATE TABLE IF NOT EXISTS `user_universe` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userId` bigint unsigned NOT NULL,
  `cik` int NOT NULL,
  `ticker` varchar(20) NOT NULL,          -- denormalized: displayable pre-ingest
  `name` varchar(255) NULL,               -- denormalized SEC directory name
  `active` tinyint(1) NOT NULL DEFAULT 1, -- the hide switch (per user)
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_universe_user_cik` (`userId`, `cik`),
  KEY `idx_user_universe_user_active` (`userId`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `threadUserId` bigint unsigned NOT NULL,  -- the non-admin user owning the thread
  `authorId` bigint unsigned NOT NULL,
  `isAdminMsg` tinyint(1) NOT NULL,
  `body` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `readAt` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `idx_messages_thread` (`threadUserId`, `id`),
  KEY `idx_messages_readAt` (`readAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `jobs` MODIFY COLUMN `type`
  enum('bootstrap','filings','stream','facts','harvest','series','sections','score','prices','universe-remove','universe-restore','universe-add')
  NOT NULL;

-- Seed existing users' universes from the legacy global flag (idempotent;
-- INSERT IGNORE because TiDB rejects ON DUPLICATE KEY UPDATE on INSERT…SELECT).
INSERT IGNORE INTO `user_universe` (`userId`, `cik`, `ticker`, `name`, `active`)
SELECT u.id, c.cik, c.ticker, c.name, c.inUniverse
FROM `users` u CROSS JOIN `companies` c;
