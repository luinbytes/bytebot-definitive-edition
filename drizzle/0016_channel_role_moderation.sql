ALTER TABLE `moderation_config` ADD `lock_role_id` text;
--> statement-breakpoint
CREATE TABLE `lockdown_ignores` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY(`guild_id`, `channel_id`)
);
--> statement-breakpoint
CREATE TABLE `lockdown_states` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`role_id` text NOT NULL,
	`prior_send_messages` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `channel_id`)
);
--> statement-breakpoint
CREATE TABLE `forced_nicknames` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`nickname` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `member_role_snapshots` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_ids` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
