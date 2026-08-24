CREATE TABLE `customization_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`nickname` text,
	`avatar_url` text,
	`banner_url` text,
	`bio` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customization_presets_name_unique` ON `customization_presets` (`guild_id`, `name`);
--> statement-breakpoint
CREATE INDEX `customization_presets_guild_idx` ON `customization_presets` (`guild_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `server_listings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon_url` text,
	`description` text,
	`member_count` integer NOT NULL,
	`invite_url` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`banner_url` text,
	`bumped_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_listings_bumped_idx` ON `server_listings` (`bumped_at`);
