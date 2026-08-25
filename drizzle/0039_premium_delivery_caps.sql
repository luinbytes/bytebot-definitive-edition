CREATE TABLE `lifecycle_message_channels` (
	`guild_id` text NOT NULL,
	`type` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY (`guild_id`, `type`, `channel_id`)
);
--> statement-breakpoint
CREATE TABLE `join_dm_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `join_dm_deliveries_guild_sent_idx` ON `join_dm_deliveries` (`guild_id`,`sent_at`);
