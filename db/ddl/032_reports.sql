CREATE TABLE IF NOT EXISTS reports (
  name varchar(128) NOT NULL,
  body mediumtext NOT NULL,
  sha256 char(64) NOT NULL,
  generatedAt timestamp NOT NULL,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
