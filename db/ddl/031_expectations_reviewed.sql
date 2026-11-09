CREATE TABLE IF NOT EXISTS expectations_reviewed_packages (
  packageVersion varchar(16) NOT NULL,
  scope varchar(64) NOT NULL,
  normalizationVersion varchar(64) NOT NULL,
  productionApply boolean NOT NULL DEFAULT FALSE,
  benchmarkEvaluationType varchar(64) NOT NULL,
  manifestJson json NOT NULL,
  readinessJson json NOT NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (packageVersion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expectations_reviewed_results (
  packageVersion varchar(16) NOT NULL,
  cik int NOT NULL,
  accessionNo varchar(20) NOT NULL,
  sourceId varchar(191) NOT NULL,
  containerId varchar(191) NOT NULL,
  inputSha256 char(64) NOT NULL,
  sourceUrl varchar(1024) NOT NULL,
  status varchar(32) NOT NULL,
  guidanceStatus varchar(32) NULL,
  statements json NOT NULL,
  extractionWarnings json NOT NULL,
  rejectedEvidence int NOT NULL DEFAULT 0,
  PRIMARY KEY (cik, accessionNo, sourceId, containerId),
  KEY expectations_reviewed_results_package (packageVersion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
