CREATE TABLE IF NOT EXISTS `bytepod_autowhitelist` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `user_id` text NOT NULL,
    `target_user_id` text NOT NULL,
    `guild_id` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bytepod_autowhitelist_owner_idx` ON `bytepod_autowhitelist` (`user_id`, `guild_id`, `id`);
