CREATE TABLE `bytepod_active_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pod_id` text NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`start_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bytepod_voice_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`total_seconds` integer DEFAULT 0,
	`session_count` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `bytepod_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`user_limit` integer DEFAULT 0,
	`auto_lock` integer DEFAULT false,
	`whitelist_user_ids` text
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`timestamp` integer DEFAULT '"2025-12-19T23:10:42.005Z"'
);
--> statement-breakpoint
INSERT INTO `__new_moderation_logs`("id", "guild_id", "target_id", "executor_id", "action", "reason", "timestamp") SELECT "id", "guild_id", "target_id", "executor_id", "action", "reason", "timestamp" FROM `moderation_logs`;--> statement-breakpoint
DROP TABLE `moderation_logs`;--> statement-breakpoint
ALTER TABLE `__new_moderation_logs` RENAME TO `moderation_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_bytepods` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT '"2025-12-19T23:10:42.005Z"'
);
--> statement-breakpoint
INSERT INTO `__new_bytepods`("channel_id", "guild_id", "owner_id", "created_at") SELECT "channel_id", "guild_id", "owner_id", "created_at" FROM `bytepods`;--> statement-breakpoint
DROP TABLE `bytepods`;--> statement-breakpoint
ALTER TABLE `__new_bytepods` RENAME TO `bytepods`;