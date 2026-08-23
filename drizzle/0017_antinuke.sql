CREATE TABLE `antinuke_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`punishment` text DEFAULT 'strip' NOT NULL,
	`window_seconds` integer DEFAULT 60 NOT NULL,
	`log_channel_id` text
);
--> statement-breakpoint
CREATE TABLE `antinuke_modules` (
	`guild_id` text NOT NULL,
	`module` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`threshold` integer DEFAULT 3 NOT NULL,
	`punishment` text,
	PRIMARY KEY(`guild_id`, `module`)
);
--> statement-breakpoint
CREATE TABLE `antinuke_admins` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `antinuke_whitelist` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `antinuke_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`module` text NOT NULL,
	`audit_entry_id` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `antinuke_actions_audit_unique` ON `antinuke_actions` (`guild_id`,`audit_entry_id`);
--> statement-breakpoint
CREATE INDEX `antinuke_actions_window_idx` ON `antinuke_actions` (`guild_id`,`actor_id`,`module`,`consumed`,`occurred_at`);
--> statement-breakpoint
CREATE TABLE `antinuke_incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`module` text NOT NULL,
	`action_count` integer NOT NULL,
	`punishment` text NOT NULL,
	`status` text NOT NULL,
	`applying_at` integer,
	`applying_token` text,
	`error` text,
	`audit_entry_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `antinuke_incidents_audit_unique` ON `antinuke_incidents` (`guild_id`,`audit_entry_id`);
--> statement-breakpoint
CREATE INDEX `antinuke_incidents_guild_created_idx` ON `antinuke_incidents` (`guild_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `antinuke_incidents_status_idx` ON `antinuke_incidents` (`status`,`id`);
