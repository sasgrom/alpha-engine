-- DDL 030: preserve complete OpenFIGI instrument labels without truncation.
-- Local reviewed migration first. Production requires a separate owner-reviewed apply.
-- No table recreation, DROP, data deletion, or ticker-index change.

ALTER TABLE cusip_map MODIFY COLUMN ticker TEXT NULL;
