-- ============================================================================
-- DDL 002 — Iteration 3a (Stage 2.1): document_sections
-- Семантические секции primary-документов как диапазоны офсетов в derived
-- plaintext (documents.textKey). Текст секций в БД НЕ дублируется.
-- Применяется вручную (apply-ddl-002.mts), идемпотентно, без DROP.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `document_sections` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `documentId` bigint unsigned NOT NULL,
  `cik` int NOT NULL,
  `accessionNo` varchar(25) NOT NULL,
  `form` varchar(12) NOT NULL,
  `sectionKey` varchar(48) NOT NULL,
  `title` varchar(255),
  `charStart` int NOT NULL,
  `charEnd` int NOT NULL,
  `flags` text,
  `parserVersion` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_section` (`documentId`, `sectionKey`, `parserVersion`),
  KEY `idx_sections_cik_form` (`cik`, `form`),
  KEY `idx_sections_key` (`sectionKey`)
);
