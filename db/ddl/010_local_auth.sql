-- ============================================================================
-- DDL 010 — Iteration 4d: local username/password auth (D33)
-- Applied manually (apply-ddl-010.mts), idempotent, no DROP / no --force.
--
--   users += username (unique, NULL for legacy Kimi rows) + passwordHash
--   (scrypt PHC-style string). unionId stays the PK-adjacent identity
--   (Kimi OAuth machinery untouched — api/kimi is read-only); local accounts
--   get unionId = 'local:<username>'. The session mechanism (HS256 JWT in
--   the same cookie) is reused as-is — auth stacks (authedQuery/adminQuery)
--   do not change.
--
--   Account seeding/removal happens in apply-ddl-010.mts (hashing needs
--   code, not SQL): admin keeps row id=1 (the owner's universe + job
--   history), every other Kimi account + their memberships/messages are
--   deleted (owner directive), one demo account user/1111 is created.
-- ============================================================================

ALTER TABLE `users` ADD COLUMN `username` varchar(64) NULL AFTER `unionId`;
ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255) NULL AFTER `username`;
ALTER TABLE `users` ADD UNIQUE KEY `uq_users_username` (`username`);
