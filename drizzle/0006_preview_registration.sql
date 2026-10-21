-- New credentials and explicit preview acknowledgements. Existing sessions and flows are preserved.
CREATE TABLE `auth_local_credentials` (
	`username` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_local_username_valid" CHECK(length("auth_local_credentials"."username") BETWEEN 4 AND 24 AND "auth_local_credentials"."username" NOT GLOB '*[^a-z0-9_]*'),
	CONSTRAINT "auth_local_hash_valid" CHECK(length("auth_local_credentials"."password_hash") BETWEEN 32 AND 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_local_credentials_account_unique` ON `auth_local_credentials` (`account_id`);--> statement-breakpoint
CREATE TABLE `auth_local_rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "auth_local_rate_count_valid" CHECK("auth_local_rate_limits"."request_count" > 0)
);
--> statement-breakpoint
CREATE INDEX `auth_local_rate_limits_expiry_index` ON `auth_local_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_local_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_hash` text NOT NULL,
	`context_hash` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "auth_local_request_action_valid" CHECK("auth_local_requests"."action" IN ('register', 'login')),
	CONSTRAINT "auth_local_request_expiry_valid" CHECK("auth_local_requests"."expires_at" > "auth_local_requests"."created_at" AND "auth_local_requests"."expires_at" <= "auth_local_requests"."created_at" + 120000)
);
--> statement-breakpoint
CREATE INDEX `auth_local_requests_binding_index` ON `auth_local_requests` (`binding_hash`);--> statement-breakpoint
CREATE INDEX `auth_local_requests_expiry_index` ON `auth_local_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_registration_consents` (
	`account_id` text PRIMARY KEY NOT NULL,
	`policy_version` text NOT NULL,
	`self_declared_14` integer NOT NULL,
	`accepted_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_registration_consent_valid" CHECK("auth_registration_consents"."self_declared_14" = 1 AND typeof("auth_registration_consents"."accepted_at") = 'integer' AND "auth_registration_consents"."accepted_at" >= 0 AND length("auth_registration_consents"."policy_version") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE `__new_auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`binding_hash` text,
	`authenticated_at` integer,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_sessions_provider_valid" CHECK("__new_auth_sessions"."provider" IN ('kakao', 'google', 'naver', 'local')),
	CONSTRAINT "auth_sessions_expiry_valid" CHECK("__new_auth_sessions"."expires_at" > "__new_auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_authenticated_at_valid" CHECK("__new_auth_sessions"."authenticated_at" IS NULL OR (typeof("__new_auth_sessions"."authenticated_at") = 'integer' AND "__new_auth_sessions"."authenticated_at" >= 0 AND "__new_auth_sessions"."authenticated_at" <= "__new_auth_sessions"."created_at"))
);
--> statement-breakpoint
INSERT INTO `__new_auth_sessions`("token_hash", "binding_hash", "authenticated_at", "account_id", "provider", "created_at", "expires_at", "revoked_at") SELECT "token_hash", "binding_hash", "authenticated_at", "account_id", "provider", "created_at", "expires_at", "revoked_at" FROM `auth_sessions`;--> statement-breakpoint
DROP TABLE `auth_sessions`;--> statement-breakpoint
ALTER TABLE `__new_auth_sessions` RENAME TO `auth_sessions`;--> statement-breakpoint
CREATE INDEX `auth_sessions_account_index` ON `auth_sessions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_index` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_binding_index` ON `auth_sessions` (`binding_hash`);--> statement-breakpoint
CREATE TABLE `__new_auth_oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`binding_hash` text NOT NULL,
	`provider` text NOT NULL,
	`audience` text NOT NULL,
	`intent` text NOT NULL,
	`account_id` text,
	`session_hash` text,
	`identity_id` text,
	`context_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`code_verifier` text NOT NULL,
	`claim_token` text,
	`signup_policy_version` text,
	`signup_confirmed_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_oauth_transactions_provider_valid" CHECK("__new_auth_oauth_transactions"."provider" IN ('kakao', 'google', 'naver')),
	CONSTRAINT "auth_oauth_transactions_intent_valid" CHECK("__new_auth_oauth_transactions"."intent" IN ('login', 'link', 'reauth')),
	CONSTRAINT "auth_oauth_transactions_link_account_valid" CHECK("__new_auth_oauth_transactions"."intent" != 'link' OR "__new_auth_oauth_transactions"."account_id" IS NOT NULL),
	CONSTRAINT "auth_oauth_transactions_reauth_valid" CHECK("__new_auth_oauth_transactions"."intent" != 'reauth' OR ("__new_auth_oauth_transactions"."account_id" IS NOT NULL AND "__new_auth_oauth_transactions"."session_hash" IS NOT NULL AND length("__new_auth_oauth_transactions"."session_hash") = 64 AND "__new_auth_oauth_transactions"."identity_id" IS NOT NULL)),
	CONSTRAINT "auth_oauth_transactions_expiry_valid" CHECK("__new_auth_oauth_transactions"."expires_at" > "__new_auth_oauth_transactions"."created_at"),
	CONSTRAINT "auth_oauth_signup_valid" CHECK(("__new_auth_oauth_transactions"."signup_policy_version" IS NULL AND "__new_auth_oauth_transactions"."signup_confirmed_at" IS NULL) OR ("__new_auth_oauth_transactions"."provider" = 'google' AND "__new_auth_oauth_transactions"."intent" = 'login' AND typeof("__new_auth_oauth_transactions"."signup_confirmed_at") = 'integer' AND "__new_auth_oauth_transactions"."signup_confirmed_at" = "__new_auth_oauth_transactions"."created_at" AND length("__new_auth_oauth_transactions"."signup_policy_version") BETWEEN 1 AND 80))
);
--> statement-breakpoint
INSERT INTO `__new_auth_oauth_transactions`("state_hash", "binding_hash", "provider", "audience", "intent", "account_id", "session_hash", "identity_id", "context_hash", "nonce_hash", "code_verifier", "claim_token", "signup_policy_version", "signup_confirmed_at", "created_at", "expires_at") SELECT "state_hash", "binding_hash", "provider", "audience", "intent", "account_id", "session_hash", "identity_id", "context_hash", "nonce_hash", "code_verifier", "claim_token", NULL, NULL, "created_at", "expires_at" FROM `auth_oauth_transactions`;--> statement-breakpoint
DROP TABLE `auth_oauth_transactions`;--> statement-breakpoint
ALTER TABLE `__new_auth_oauth_transactions` RENAME TO `auth_oauth_transactions`;--> statement-breakpoint
CREATE INDEX `auth_oauth_transactions_expiry_index` ON `auth_oauth_transactions` (`expires_at`);