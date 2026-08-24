CREATE TABLE IF NOT EXISTS `activity_logs` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `user_id` text NOT NULL,
    `guild_id` text NOT NULL,
    `activity_date` text NOT NULL,
    `message_count` integer DEFAULT 0 NOT NULL,
    `voice_minutes` integer DEFAULT 0 NOT NULL,
    `commands_run` integer DEFAULT 0 NOT NULL,
    `reactions_given` integer DEFAULT 0 NOT NULL,
    `channels_joined` integer DEFAULT 0 NOT NULL,
    `bytepods_created` integer DEFAULT 0 NOT NULL,
    `unique_commands_used` text,
    `active_hours` text,
    `first_activity_time` integer,
    `last_activity_time` integer,
    `updated_at` integer,
    UNIQUE (`user_id`,`guild_id`,`activity_date`)
);
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `text_xp_awarded` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `voice_seconds` integer DEFAULT 0 NOT NULL;
