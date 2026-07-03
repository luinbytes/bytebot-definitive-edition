CREATE TABLE `honeypot_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`channel_id` text,
	`warning_message_id` text,
	`shame_board_message_id` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`pin_warning_failed` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `honeypot_config_channel_id_unique` ON `honeypot_config` (`channel_id`);
--> statement-breakpoint
CREATE INDEX `honeypot_config_channel_idx` ON `honeypot_config` (`channel_id`);
--> statement-breakpoint
CREATE INDEX `honeypot_config_enabled_channel_idx` ON `honeypot_config` (`enabled`,`channel_id`);
--> statement-breakpoint
CREATE TABLE `honeypot_exempt_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `honeypot_exempt_roles_guild_id_role_id_unique` ON `honeypot_exempt_roles` (`guild_id`,`role_id`);
--> statement-breakpoint
CREATE INDEX `honeypot_exempt_roles_guild_idx` ON `honeypot_exempt_roles` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `honeypot_exempt_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `honeypot_exempt_users_guild_id_user_id_unique` ON `honeypot_exempt_users` (`guild_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `honeypot_exempt_users_guild_idx` ON `honeypot_exempt_users` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `honeypot_incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text,
	`display_name` text,
	`message_id` text,
	`channel_id` text NOT NULL,
	`snippet` text,
	`attachment_summary` text,
	`status` text NOT NULL,
	`failure_reason` text,
	`account_created_at` integer,
	`joined_at` integer,
	`triggered_at` integer DEFAULT 1783109389599 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `honeypot_incidents_guild_triggered_idx` ON `honeypot_incidents` (`guild_id`,`triggered_at`);
--> statement-breakpoint
CREATE INDEX `honeypot_incidents_guild_status_idx` ON `honeypot_incidents` (`guild_id`,`status`);
