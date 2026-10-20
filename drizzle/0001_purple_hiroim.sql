CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`audience` text NOT NULL,
	`subject` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_identities_provider_valid" CHECK("auth_identities"."provider" IN ('kakao', 'google', 'naver'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_subject_unique` ON `auth_identities` (`provider`,`issuer`,`audience`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_account_provider_unique` ON `auth_identities` (`account_id`,`provider`);--> statement-breakpoint
CREATE TABLE `auth_oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`binding_hash` text NOT NULL,
	`provider` text NOT NULL,
	`audience` text NOT NULL,
	`intent` text NOT NULL,
	`account_id` text,
	`context_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_oauth_transactions_provider_valid" CHECK("auth_oauth_transactions"."provider" IN ('kakao', 'google', 'naver')),
	CONSTRAINT "auth_oauth_transactions_intent_valid" CHECK("auth_oauth_transactions"."intent" IN ('login', 'link')),
	CONSTRAINT "auth_oauth_transactions_link_account_valid" CHECK("auth_oauth_transactions"."intent" != 'link' OR "auth_oauth_transactions"."account_id" IS NOT NULL),
	CONSTRAINT "auth_oauth_transactions_expiry_valid" CHECK("auth_oauth_transactions"."expires_at" > "auth_oauth_transactions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `auth_oauth_transactions_expiry_index` ON `auth_oauth_transactions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL,
	CONSTRAINT "auth_rate_limits_bucket_valid" CHECK("auth_rate_limits"."bucket" IN ('start:kakao', 'start:google', 'start:naver', 'callback:kakao', 'callback:google', 'callback:naver'))
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_sessions_provider_valid" CHECK("auth_sessions"."provider" IN ('kakao', 'google', 'naver')),
	CONSTRAINT "auth_sessions_expiry_valid" CHECK("auth_sessions"."expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_account_index` ON `auth_sessions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_index` ON `auth_sessions` (`expires_at`);