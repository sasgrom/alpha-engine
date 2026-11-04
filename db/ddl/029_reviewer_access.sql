-- DDL 029: reviewer NDA, first-IP binding and guided-tour preferences.
-- Idempotent. No DROP, no schema rewrite, no credential material.

CREATE TABLE IF NOT EXISTS `reviewer_access` (
  `userId` bigint unsigned NOT NULL,
  `firstIpHash` varchar(64) NULL,
  `ndaVersion` varchar(32) NOT NULL,
  `acceptedAt` timestamp NULL,
  `acceptedIpHash` varchar(64) NULL,
  `acceptedUserAgent` text NULL,
  `acceptedSessionUnionId` varchar(255) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`),
  CONSTRAINT `fk_reviewer_access_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
);

CREATE TABLE IF NOT EXISTS `reviewer_tour_preferences` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userId` bigint unsigned NOT NULL,
  `track` varchar(16) NOT NULL,
  `currentStep` int NOT NULL DEFAULT 0,
  `status` varchar(24) NOT NULL DEFAULT 'not_started',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reviewer_tour_user_track` (`userId`, `track`),
  CONSTRAINT `fk_reviewer_tour_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
);

CREATE INDEX `idx_reviewer_access_accepted` ON `reviewer_access` (`acceptedAt`);
