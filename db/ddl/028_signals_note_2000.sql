-- DDL 028: retain complete multi-window LLM rationales.
-- Widening VARCHAR preserves every existing note and all table data.
ALTER TABLE `signals` MODIFY COLUMN `note` varchar(2000) NULL;
