-- DDL 019 (5b/5c, D50): signals.note (model rationale, human-facing) +
-- uq_signals gains payloadKey so a different LLM model re-scoring the same
-- event lands alongside instead of being INSERT-IGNORE'd.
-- Idempotent; applied by apply-ddl-019.mts.

-- note column (added via guarded applier — information_schema check)
ALTER TABLE `signals` ADD COLUMN `note` varchar(512) NULL;

-- unique index swap: (cik, source, signalType, eventTs) → + payloadKey
ALTER TABLE `signals` DROP INDEX `uq_signals`;
ALTER TABLE `signals` ADD UNIQUE KEY `uq_signals` (`cik`, `source`, `signalType`, `eventTs`, `payloadKey`);
