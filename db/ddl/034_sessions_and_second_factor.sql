-- DDL 034: signed-in sessions (so one can be ended) and the second factor of an account.
-- Owner's decision of 2026-11-24 ("implement 1,2,3"). Idempotent. No DROP, no change to an existing table.
-- Neither table holds a password, a session token or a readable second-factor secret: the token is stored as its
-- SHA-256, the secret encrypted with a key derived from the server's own secret, recovery codes as their SHA-256.

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userId` bigint unsigned NOT NULL,
  `tokenHash` char(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL,
  `ip` varchar(64) NULL,
  `userAgent` varchar(255) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_sessions_token` (`tokenHash`),
  KEY `idx_user_sessions_user` (`userId`, `revokedAt`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `user_second_factor` (
  `userId` bigint unsigned NOT NULL,
  `secretEnc` varchar(255) NOT NULL,
  `enabledAt` timestamp NULL,
  `lastStep` bigint NOT NULL DEFAULT 0,
  `recoveryHashes` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`),
  CONSTRAINT `fk_user_second_factor_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
