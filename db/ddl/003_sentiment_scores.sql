-- ============================================================================
-- DDL 003 — Iteration 3a (Stage 2.2): sentiment_scores + расширение jobs.type
-- Применяется вручную (apply-ddl-003.mts), идемпотентно, без DROP.
--   1. jobs.type enum += 'sections','score' (обратно-совместимое расширение)
--   2. sentiment_scores: версионные оценки LLM, ключ идемпотентности =
--      (documentId, sectionKey, aspect, llmVersion, promptVersion)
-- ============================================================================
ALTER TABLE `jobs`
  MODIFY COLUMN `type` enum('bootstrap','filings','stream','facts','harvest','series','sections','score') NOT NULL;

CREATE TABLE IF NOT EXISTS `sentiment_scores` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cik` int NOT NULL,
  `accessionNo` varchar(25) NOT NULL,
  `form` varchar(12) NOT NULL,
  `documentId` bigint unsigned NOT NULL,
  `sectionId` bigint unsigned,
  `sectionKey` varchar(48) NOT NULL,
  `aspect` varchar(24) NOT NULL,
  `score` double NOT NULL,
  `confidence` double NOT NULL,
  `evidence` text,
  `evidenceOk` boolean NOT NULL,
  `pairwise` boolean NOT NULL DEFAULT false,
  `llmVersion` varchar(120) NOT NULL,
  `promptVersion` varchar(24) NOT NULL,
  `usageTokens` int,
  `scoredAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_score_idem` (`documentId`, `sectionKey`, `aspect`, `llmVersion`, `promptVersion`),
  KEY `idx_scores_cik_aspect` (`cik`, `aspect`),
  KEY `idx_scores_accn` (`accessionNo`)
);
