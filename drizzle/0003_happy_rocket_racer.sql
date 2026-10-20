ALTER TABLE `auth_sessions` ADD `binding_hash` text;--> statement-breakpoint
CREATE INDEX `auth_sessions_binding_index` ON `auth_sessions` (`binding_hash`);