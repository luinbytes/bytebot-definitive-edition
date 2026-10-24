CREATE TABLE IF NOT EXISTS `activity_streaks` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `user_id` text NOT NULL,
    `guild_id` text NOT NULL,
    `current_streak` integer DEFAULT 0 NOT NULL,
    `longest_streak` integer DEFAULT 0 NOT NULL,
    `last_activity_date` text,
    `total_active_days` integer DEFAULT 0 NOT NULL,
    `freezes_available` integer DEFAULT 1 NOT NULL,
    `last_freeze_reset` integer,
    `created_at` integer DEFAULT '"2026-01-02T22:29:33.684Z"',
    `updated_at` integer DEFAULT '"2026-01-02T22:29:33.684Z"'
);
--> statement-breakpoint
ALTER TABLE `activity_streaks` ADD COLUMN `streak_covered_through` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `activity_streaks_user_id_guild_id_unique` ON `activity_streaks` (`user_id`, `guild_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `streaks_guild_current_idx` ON `activity_streaks` (`guild_id`, `current_streak`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `streaks_guild_longest_idx` ON `activity_streaks` (`guild_id`, `longest_streak`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `streaks_user_guild_idx` ON `activity_streaks` (`user_id`, `guild_id`);
