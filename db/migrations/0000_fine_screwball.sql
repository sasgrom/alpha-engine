CREATE TABLE `companies` (
	`cik` int NOT NULL,
	`ticker` varchar(20) NOT NULL,
	`name` varchar(255),
	`sic` varchar(16),
	`sicDescription` varchar(255),
	`exchange` varchar(64),
	`fiscalYearEnd` varchar(8),
	`inUniverse` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `companies_cik` PRIMARY KEY(`cik`)
);
--> statement-breakpoint
CREATE TABLE `facts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cik` int NOT NULL,
	`taxonomy` varchar(20) NOT NULL,
	`concept` varchar(200) NOT NULL,
	`unit` varchar(40) NOT NULL,
	`startDate` date,
	`endDate` date,
	`val` double,
	`fy` int,
	`fp` varchar(8),
	`form` varchar(12),
	`filed` date,
	`accn` varchar(25),
	CONSTRAINT `facts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `filings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cik` int NOT NULL,
	`accessionNo` varchar(25) NOT NULL,
	`form` varchar(12) NOT NULL,
	`filingDate` date,
	`reportDate` date,
	`primaryDoc` varchar(255),
	`isDownloaded` boolean NOT NULL DEFAULT false,
	`ingestedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `filings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_filings_cik_accn` UNIQUE(`cik`,`accessionNo`)
);
--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`jobId` bigint unsigned NOT NULL,
	`ts` timestamp NOT NULL DEFAULT (now()),
	`level` enum('info','warn','error') NOT NULL DEFAULT 'info',
	`message` text NOT NULL,
	CONSTRAINT `job_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`type` enum('bootstrap','filings','stream','facts') NOT NULL,
	`status` enum('queued','running','done','error','cancelled') NOT NULL DEFAULT 'queued',
	`params` text,
	`processed` int NOT NULL DEFAULT 0,
	`total` int NOT NULL DEFAULT 0,
	`message` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` text,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE INDEX `idx_companies_ticker` ON `companies` (`ticker`);--> statement-breakpoint
CREATE INDEX `idx_facts_cik_concept` ON `facts` (`cik`,`concept`,`endDate`);--> statement-breakpoint
CREATE INDEX `idx_facts_concept` ON `facts` (`concept`);--> statement-breakpoint
CREATE INDEX `idx_filings_cik_form` ON `filings` (`cik`,`form`);--> statement-breakpoint
CREATE INDEX `idx_filings_date` ON `filings` (`filingDate`);--> statement-breakpoint
CREATE INDEX `idx_joblogs_job` ON `job_logs` (`jobId`,`id`);