PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`timestamp` integer DEFAULT '"2025-12-20T01:20:40.573Z"'
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
	`original_owner_id` text,
	`owner_left_at` integer,
	`created_at` integer DEFAULT '"2025-12-20T01:20:40.573Z"'
);
--> statement-breakpoint
INSERT INTO `__new_bytepods`("channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "created_at") SELECT "channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "created_at" FROM `bytepods`;--> statement-breakpoint
DROP TABLE `bytepods`;--> statement-breakpoint
ALTER TABLE `__new_bytepods` RENAME TO `bytepods`;