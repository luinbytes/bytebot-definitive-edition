CREATE TABLE `guilds` (
	`id` text PRIMARY KEY NOT NULL,
	`prefix` text DEFAULT '!',
	`log_channel` text,
	`welcome_channel` text,
	`joined_at` integer,
	`voice_hub_channel_id` text,
	`voice_hub_category_id` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`commands_run` integer DEFAULT 0,
	`last_seen` integer,
	`wt_nickname` text
);
--> statement-breakpoint
CREATE TABLE `moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`timestamp` integer DEFAULT '"2025-12-19T01:45:48.866Z"'
);
--> statement-breakpoint
CREATE TABLE `command_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`command_name` text NOT NULL,
	`role_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bytepods` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT '"2025-12-19T01:45:48.867Z"'
);
--> statement-breakpoint
CREATE TABLE `bytepod_autowhitelist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`guild_id` text
);
--> statement-breakpoint
CREATE TABLE `bytepod_user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`auto_lock` integer DEFAULT false
);
