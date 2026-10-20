CREATE TABLE `guardian_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`guardian_account_id` text NOT NULL,
	`child_account_id` text,
	`proof_hash` text NOT NULL,
	`jti_hash` text NOT NULL,
	`subject_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`policy_version` text NOT NULL,
	`approved_at` integer NOT NULL,
	`withdrawn_at` integer,
	CONSTRAINT "guardian_consents_scopes_valid" CHECK(json_valid("guardian_consents"."scopes"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_consents_proof_unique` ON `guardian_consents` (`proof_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_consents_jti_unique` ON `guardian_consents` (`jti_hash`);--> statement-breakpoint
CREATE INDEX `guardian_consents_guardian_index` ON `guardian_consents` (`guardian_account_id`);--> statement-breakpoint
CREATE TABLE `guardian_links` (
	`child_account_id` text PRIMARY KEY NOT NULL,
	`guardian_account_id` text NOT NULL,
	`consent_id` text NOT NULL,
	`state` text NOT NULL,
	`linked_at` integer NOT NULL,
	CONSTRAINT "guardian_links_state_valid" CHECK("guardian_links"."state" IN ('active', 'withdrawn')),
	CONSTRAINT "guardian_links_distinct_accounts" CHECK("guardian_links"."guardian_account_id" != "guardian_links"."child_account_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_links_consent_unique` ON `guardian_links` (`consent_id`);--> statement-breakpoint
CREATE INDEX `guardian_links_guardian_index` ON `guardian_links` (`guardian_account_id`);--> statement-breakpoint
CREATE TABLE `guardian_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`guardian_account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`policy_version` text NOT NULL,
	`state` text NOT NULL,
	`consume_token` text,
	CONSTRAINT "guardian_request_state_valid" CHECK("guardian_requests"."state" IN ('pending', 'approved', 'consumed')),
	CONSTRAINT "guardian_request_deadline_valid" CHECK("guardian_requests"."expires_at" > "guardian_requests"."created_at" AND "guardian_requests"."expires_at" <= "guardian_requests"."created_at" + 432000000)
);
--> statement-breakpoint
CREATE INDEX `guardian_requests_expiry_index` ON `guardian_requests` (`expires_at`);--> statement-breakpoint
CREATE INDEX `guardian_requests_guardian_index` ON `guardian_requests` (`guardian_account_id`);--> statement-breakpoint
CREATE TABLE `privacy_account_controls` (
	`account_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "privacy_account_state_valid" CHECK("privacy_account_controls"."state" IN ('pending', 'active', 'withdrawn', 'deletion_pending', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE `privacy_deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`status` text NOT NULL,
	CONSTRAINT "privacy_deletion_status_valid" CHECK("privacy_deletion_jobs"."status" IN ('pending', 'complete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_deletion_account_unique` ON `privacy_deletion_jobs` (`account_id`);--> statement-breakpoint
CREATE INDEX `privacy_deletion_status_index` ON `privacy_deletion_jobs` (`status`,`requested_at`);