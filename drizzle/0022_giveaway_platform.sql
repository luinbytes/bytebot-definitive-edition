CREATE TABLE `giveaway_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`dm_creator` integer DEFAULT false NOT NULL,
	`dm_winners` integer DEFAULT false NOT NULL,
	`template` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `giveaway_presets` (
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`script` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `giveaway_blacklist` (
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `role_id`)
);
--> statement-breakpoint
CREATE TABLE `giveaway_role_limits` (
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`max_entries` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `role_id`)
);
--> statement-breakpoint
CREATE TABLE `member_levels` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`host_id` text NOT NULL,
	`prize` text NOT NULL,
	`description` text,
	`required_role_id` text,
	`image_url` text,
	`thumbnail_url` text,
	`winner_count` integer NOT NULL,
	`min_level` integer,
	`max_level` integer,
	`template_snapshot` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giveaways_message_unique` ON `giveaways` (`message_id`);
--> statement-breakpoint
CREATE INDEX `giveaways_due_idx` ON `giveaways` (`status`, `ends_at`);
--> statement-breakpoint
CREATE INDEX `giveaways_guild_status_idx` ON `giveaways` (`guild_id`, `status`);
--> statement-breakpoint
CREATE TABLE `giveaway_entries` (
	`giveaway_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`entries` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`giveaway_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `giveaway_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`giveaway_id` integer NOT NULL,
	`round_number` integer NOT NULL,
	`candidates_snapshot` text NOT NULL,
	`exclusions_snapshot` text NOT NULL,
	`winners_snapshot` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivery_token` text,
	`delivery_lease_until` integer,
	`announced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giveaway_rounds_number_unique` ON `giveaway_rounds` (`giveaway_id`, `round_number`);
--> statement-breakpoint
CREATE TABLE `giveaway_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`giveaway_id` integer NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `giveaway_actions_giveaway_idx` ON `giveaway_actions` (`giveaway_id`, `id`);
