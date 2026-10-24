-- DDL 026 (5g fix): fund_jobs — per-fund-quarter COMPLETION marker. The old
-- seen-quarter guard ("any rows exist") skipped partially-failed quarters
-- forever (2026-09-30 ended up with 2,710 rows vs 82,057 for 2026-06-30).
-- A quarter is seen ONLY when its block completed (holdings + events written).
CREATE TABLE IF NOT EXISTS `fund_jobs` (
  `fundCik` int NOT NULL,
  `quarterDate` date NOT NULL,
  `doneAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fundCik`, `quarterDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
