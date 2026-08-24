CREATE TABLE `guild_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`schema_version` integer NOT NULL,
	`payload` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guild_backups_name_unique` ON `guild_backups` (`guild_id`, `creator_id`, `name`);
--> statement-breakpoint
CREATE INDEX `guild_backups_owner_idx` ON `guild_backups` (`guild_id`, `creator_id`, `created_at`);
