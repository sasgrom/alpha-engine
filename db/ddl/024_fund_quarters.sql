-- DDL 024 (5g fix): fund_quarters — the fund's FULL 13F book total per
-- quarter, computed from the complete parsed information table (autoScaled),
-- BEFORE universe filtering. "% of fund" must divide by the real book, never
-- by the mapped subset (rebuild-events inflated it ~75× for Point72).
CREATE TABLE IF NOT EXISTS `fund_quarters` (
  `fundCik` int NOT NULL,
  `quarterDate` date NOT NULL,
  `totalValueUsd` bigint NULL,
  `positions` int NULL,
  `accessionNo` varchar(25) NULL,
  PRIMARY KEY (`fundCik`, `quarterDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
