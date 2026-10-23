-- DDL 022 (5f): 13F institutional holdings — quarterly positions of the
-- curated manager universe (worker/funds-13f.json) in S&P 500 securities,
-- plus the CUSIP→company crosswalk cache (OpenFIGI).
CREATE TABLE IF NOT EXISTS `fund_holdings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `fundCik` int NOT NULL,
  `fundName` varchar(128) NOT NULL,
  `cusip` varchar(12) NOT NULL,
  `heldCik` int NULL,            -- NULL until the CUSIP maps to a company
  `issuer` varchar(255) NULL,    -- nameOfIssuer as filed
  `shares` bigint NULL,
  `valueUsd` bigint NULL,        -- 13F value (thousands) × 1000
  `quarterDate` date NOT NULL,   -- reportDate (period of report)
  `accessionNo` varchar(25) NOT NULL,
  `tier` varchar(16) NULL,       -- activist | quant | fundamental | passive
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fund_holding` (`fundCik`, `cusip`, `quarterDate`),
  KEY `idx_fh_held` (`heldCik`, `quarterDate`),
  KEY `idx_fh_fund` (`fundCik`, `quarterDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cusip_map` (
  `cusip` varchar(12) NOT NULL,
  `cik` int NULL,
  `ticker` varchar(20) NULL,
  `mappedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cusip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
