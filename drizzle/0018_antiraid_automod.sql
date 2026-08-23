CREATE TABLE `antiraid_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`punishment` text DEFAULT 'kick' NOT NULL,
	`username_punishment` text DEFAULT 'kick' NOT NULL,
	`unverifiedbot_punishment` text DEFAULT 'kick' NOT NULL,
	`massmention_threshold` integer DEFAULT 5 NOT NULL,
	`massmention_punishment` text DEFAULT 'timeout' NOT NULL,
	`massmention_lockdown_seconds` integer DEFAULT 0 NOT NULL,
	`lockdown_enabled` integer DEFAULT 0 NOT NULL,
	`lockdown_expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `antiraid_modules` (
	`guild_id` text NOT NULL,
	`module` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`threshold` integer DEFAULT 5 NOT NULL,
	`window_seconds` integer DEFAULT 60 NOT NULL,
	`punishment` text,
	`lock_channels` integer DEFAULT 0 NOT NULL,
	`punish_members` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `module`)
);
--> statement-breakpoint
CREATE TABLE `antiraid_username_patterns` (
	`guild_id` text NOT NULL,
	`pattern` text NOT NULL,
	`punishment` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `pattern`)
);
--> statement-breakpoint
CREATE TABLE `antiraid_exemptions` (
	`guild_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `target_type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `antiraid_incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`module` text NOT NULL,
	`action_count` integer DEFAULT 1 NOT NULL,
	`punishment` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `antiraid_incidents_guild_created_idx` ON `antiraid_incidents` (`guild_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `automod_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`timeout_ms` integer DEFAULT 300000 NOT NULL,
	`strikes_enabled` integer DEFAULT 0 NOT NULL,
	`strike_decay_hours` integer DEFAULT 24 NOT NULL,
	`strike_cap` integer DEFAULT 10 NOT NULL,
	`native_rule_id` text,
	`native_nsfw_rule_id` text
);
--> statement-breakpoint
CREATE TABLE `automod_filters` (
	`guild_id` text NOT NULL,
	`filter` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`threshold` integer DEFAULT 5 NOT NULL,
	`secondary_threshold` integer DEFAULT 0 NOT NULL,
	`action` text DEFAULT 'delete' NOT NULL,
	PRIMARY KEY(`guild_id`, `filter`)
);
--> statement-breakpoint
CREATE TABLE `automod_rules` (
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `kind`, `name`)
);
--> statement-breakpoint
CREATE TABLE `automod_exemptions` (
	`guild_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `target_type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `automod_strike_levels` (
	`guild_id` text NOT NULL,
	`level` integer NOT NULL,
	`action` text NOT NULL,
	`duration_ms` integer,
	PRIMARY KEY(`guild_id`, `level`)
);
--> statement-breakpoint
CREATE TABLE `automod_strikes` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_strike_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `automod_incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`filter` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automod_incidents_message_unique` ON `automod_incidents` (`guild_id`,`message_id`);
--> statement-breakpoint
CREATE INDEX `automod_incidents_guild_created_idx` ON `automod_incidents` (`guild_id`,`created_at`);
