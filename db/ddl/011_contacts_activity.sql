-- ============================================================================
-- DDL 011 — Iteration 4e: messenger contacts (D34) + activity tracking (D35)
-- Applied manually (apply-ddl-011.mts), idempotent, no DROP / no --force.
--
--   1. messages += convKey varchar(32), recipientId bigint — the thread model
--      generalizes from "user↔admin" (4c) to PAIRWISE DM between any two
--      users: convKey = '<minId>_<maxId>', recipientId drives unread counts.
--      threadUserId/isAdminMsg stay in the DB deprecated (never-delete rule);
--      the table held 0 rows at rework time.
--
--   2. NEW TABLE activity_events — the activity log behind the admin's
--      per-user info summary (D35): login/signup events (server-side) and
--      page views (client tracker). Small by construction; trimmed by
--      retention if it ever grows.
-- ============================================================================

ALTER TABLE `messages` ADD COLUMN `convKey` varchar(32) NULL AFTER `threadUserId`;
ALTER TABLE `messages` ADD COLUMN `recipientId` bigint unsigned NULL AFTER `authorId`;
ALTER TABLE `messages` ADD KEY `idx_messages_conv` (`convKey`, `id`);
ALTER TABLE `messages` ADD KEY `idx_messages_recipient` (`recipientId`, `readAt`);

CREATE TABLE IF NOT EXISTS `activity_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userId` bigint unsigned NOT NULL,
  `type` varchar(24) NOT NULL,          -- login | signup | page
  `path` varchar(255) NULL,             -- page path for type='page'
  `ip` varchar(64) NULL,
  `meta` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_user` (`userId`, `id`),
  KEY `idx_activity_type_ts` (`type`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
