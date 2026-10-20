-- New proof fields must stay NULL for existing rows; issuance is not authentication.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_oauth_transactions_provider_valid" CHECK("__new_auth_oauth_transactions"."provider" IN ('kakao', 'google', 'naver')),
	CONSTRAINT "auth_oauth_transactions_intent_valid" CHECK("__new_auth_oauth_transactions"."intent" IN ('login', 'link', 'reauth')),
	CONSTRAINT "auth_oauth_transactions_link_account_valid" CHECK("__new_auth_oauth_transactions"."intent" != 'link' OR "__new_auth_oauth_transactions"."account_id" IS NOT NULL),
	CONSTRAINT "auth_oauth_transactions_reauth_valid" CHECK("__new_auth_oauth_transactions"."intent" != 'reauth' OR ("__new_auth_oauth_transactions"."account_id" IS NOT NULL AND "__new_auth_oauth_transactions"."session_hash" IS NOT NULL AND length("__new_auth_oauth_transactions"."session_hash") = 64 AND "__new_auth_oauth_transactions"."identity_id" IS NOT NULL)),
	CONSTRAINT "auth_oauth_transactions_expiry_valid" CHECK("__new_auth_oauth_transactions"."expires_at" > "__new_auth_oauth_transactions"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_auth_oauth_transactions`("state_hash", "binding_hash", "provider", "audience", "intent", "account_id", "session_hash", "identity_id", "context_hash", "nonce_hash", "code_verifier", "claim_token", "created_at", "expires_at") SELECT "state_hash", "binding_hash", "provider", "audience", "intent", "account_id", NULL, NULL, "context_hash", "nonce_hash", "code_verifier", "claim_token", "created_at", "expires_at" FROM `auth_oauth_transactions`;--> statement-breakpoint
DROP TABLE `auth_oauth_transactions`;--> statement-breakpoint
ALTER TABLE `__new_auth_oauth_transactions` RENAME TO `auth_oauth_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `auth_oauth_transactions_expiry_index` ON `auth_oauth_transactions` (`expires_at`);--> statement-breakpoint
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
	CONSTRAINT "auth_sessions_provider_valid" CHECK("__new_auth_sessions"."provider" IN ('kakao', 'google', 'naver')),
	CONSTRAINT "auth_sessions_expiry_valid" CHECK("__new_auth_sessions"."expires_at" > "__new_auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_authenticated_at_valid" CHECK("__new_auth_sessions"."authenticated_at" IS NULL OR (typeof("__new_auth_sessions"."authenticated_at") = 'integer' AND "__new_auth_sessions"."authenticated_at" >= 0 AND "__new_auth_sessions"."authenticated_at" <= "__new_auth_sessions"."created_at"))
);
--> statement-breakpoint
INSERT INTO `__new_auth_sessions`("token_hash", "binding_hash", "authenticated_at", "account_id", "provider", "created_at", "expires_at", "revoked_at") SELECT "token_hash", "binding_hash", NULL, "account_id", "provider", "created_at", "expires_at", "revoked_at" FROM `auth_sessions`;--> statement-breakpoint
DROP TABLE `auth_sessions`;--> statement-breakpoint
ALTER TABLE `__new_auth_sessions` RENAME TO `auth_sessions`;--> statement-breakpoint
CREATE INDEX `auth_sessions_account_index` ON `auth_sessions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_index` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_binding_index` ON `auth_sessions` (`binding_hash`);