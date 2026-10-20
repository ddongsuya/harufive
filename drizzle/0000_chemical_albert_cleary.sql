CREATE TABLE `game_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`week` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_attempts_mode_valid" CHECK("game_attempts"."mode" IN ('daily', 'practice')),
	CONSTRAINT "game_attempts_status_valid" CHECK("game_attempts"."status" IN ('active', 'complete', 'expired')),
	CONSTRAINT "game_attempts_payload_json" CHECK(json_valid("game_attempts"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_attempts_user_day_mode_unique` ON `game_attempts` (`user_id`,`day`,`mode`);--> statement-breakpoint
CREATE INDEX `game_attempts_week_index` ON `game_attempts` (`week`);--> statement-breakpoint
CREATE TABLE `game_closed_weeks` (
	`week` text PRIMARY KEY NOT NULL,
	`close_token` text NOT NULL,
	`closed_at` integer NOT NULL,
	`rules_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_coin_ledger` (
	`user_id` text NOT NULL,
	`reference` text NOT NULL,
	`reason` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `reference`),
	FOREIGN KEY (`user_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `game_mutation_receipts` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`),
	FOREIGN KEY (`user_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `game_players` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`coins` integer NOT NULL,
	`owned` text NOT NULL,
	`equipped` text NOT NULL,
	`active_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`mutation_token` text,
	`created_day` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "game_players_nonnegative_coins" CHECK("game_players"."coins" >= 0 AND typeof("game_players"."coins") = 'integer'),
	CONSTRAINT "game_players_revision_valid" CHECK("game_players"."revision" >= 0),
	CONSTRAINT "game_players_inventory_json" CHECK(json_valid("game_players"."owned") AND json_valid("game_players"."equipped"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_public_id_unique` ON `game_players` (`public_id`);--> statement-breakpoint
CREATE TABLE `game_rate_limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_results` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`week` text NOT NULL,
	`mode` text NOT NULL,
	`correct` integer NOT NULL,
	`total_time_ms` integer NOT NULL,
	`score_cent` integer NOT NULL,
	`result` text NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `game_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_results_correct_valid" CHECK("game_results"."correct" BETWEEN 0 AND 5),
	CONSTRAINT "game_results_time_valid" CHECK("game_results"."total_time_ms" >= 0),
	CONSTRAINT "game_results_score_valid" CHECK("game_results"."score_cent" BETWEEN 0 AND 509900),
	CONSTRAINT "game_results_json_valid" CHECK(json_valid("game_results"."result"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_results_user_day_mode_unique` ON `game_results` (`user_id`,`day`,`mode`);--> statement-breakpoint
CREATE INDEX `game_results_week_mode_index` ON `game_results` (`week`,`mode`);--> statement-breakpoint
CREATE TABLE `game_weekly_awards` (
	`user_id` text NOT NULL,
	`week` text NOT NULL,
	`correct` integer NOT NULL,
	`total_time_ms` integer NOT NULL,
	`played_days` integer NOT NULL,
	`rank` integer NOT NULL,
	`participants` integer NOT NULL,
	`tier_id` text NOT NULL,
	`coins` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week`),
	FOREIGN KEY (`user_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`week`) REFERENCES `game_closed_weeks`(`week`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_weekly_awards_week_index` ON `game_weekly_awards` (`week`);