CREATE TABLE `uwu_lock_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uwu_lock_members_guild_id_user_id_unique` ON `uwu_lock_members` (`guild_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `uwu_lock_members_guild_state_idx` ON `uwu_lock_members` (`guild_id`,`state`);
