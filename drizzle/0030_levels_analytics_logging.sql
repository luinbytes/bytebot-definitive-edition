CREATE TABLE `level_configs` (
    `guild_id` text PRIMARY KEY NOT NULL,
    `text_enabled` integer DEFAULT 1 NOT NULL,
    `voice_enabled` integer DEFAULT 1 NOT NULL,
    `award_channel_id` text,
    `award_message` text,
    `message_enabled` integer DEFAULT 0 NOT NULL,
    `dm_enabled` integer DEFAULT 0 NOT NULL,
    `antiafk_enabled` integer DEFAULT 1 NOT NULL,
    `text_cooldown_seconds` integer DEFAULT 60 NOT NULL,
    `voice_xp_per_minute` integer DEFAULT 5 NOT NULL,
    `voice_min_seconds` integer DEFAULT 60 NOT NULL,
    `voice_session_xp_cap` integer DEFAULT 3600 NOT NULL,
    `base_multiplier` real DEFAULT 1 NOT NULL,
    `stack_roles` integer DEFAULT 0 NOT NULL,
    `baseline_at` integer,
    `updated_at` integer NOT NULL,
    CONSTRAINT `level_configs_rate_check` CHECK (`base_multiplier` BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE `level_role_rewards` (
    `guild_id` text NOT NULL,
    `level` integer NOT NULL,
    `role_id` text NOT NULL,
    `created_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`level`),
    CONSTRAINT `level_role_rewards_level_check` CHECK (`level` BETWEEN 1 AND 999),
    UNIQUE (`guild_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `level_ignores` (
    `guild_id` text NOT NULL,
    `target_type` text NOT NULL,
    `target_id` text NOT NULL,
    `created_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `level_boosts` (
    `guild_id` text NOT NULL,
    `target_type` text NOT NULL,
    `target_id` text NOT NULL,
    `multiplier` real NOT NULL,
    `created_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`target_type`,`target_id`),
    CONSTRAINT `level_boosts_multiplier_check` CHECK (`multiplier` BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE `level_live_boards` (
    `guild_id` text NOT NULL,
    `channel_id` text NOT NULL,
    `metric` text NOT NULL,
    `message_id` text,
    `revision` integer DEFAULT 0 NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`channel_id`,`metric`)
);
--> statement-breakpoint
CREATE TABLE `level_rank_cards` (
    `user_id` text PRIMARY KEY NOT NULL,
    `accent` text,
    `layout` text DEFAULT 'classic' NOT NULL,
    `background_data` blob,
    `background_mime` text,
    `avatar_border` integer DEFAULT 4 NOT NULL,
    `updated_at` integer NOT NULL,
    CONSTRAINT `level_rank_cards_layout_check` CHECK (`layout` IN ('classic','compact')),
    CONSTRAINT `level_rank_cards_border_check` CHECK (`avatar_border` BETWEEN 0 AND 20)
);
--> statement-breakpoint
CREATE TABLE `server_daily_metrics` (
    `guild_id` text NOT NULL,
    `activity_date` text NOT NULL,
    `message_count` integer DEFAULT 0 NOT NULL,
    `reaction_count` integer DEFAULT 0 NOT NULL,
    `voice_seconds` integer DEFAULT 0 NOT NULL,
    `joins` integer DEFAULT 0 NOT NULL,
    `leaves` integer DEFAULT 0 NOT NULL,
    `member_count` integer,
    `baseline_at` integer,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`activity_date`)
);
--> statement-breakpoint
CREATE INDEX `server_daily_metrics_date_idx` ON `server_daily_metrics` (`activity_date`);
--> statement-breakpoint
CREATE TABLE `analytics_events` (
    `guild_id` text NOT NULL,
    `event_type` text NOT NULL,
    `event_id` text NOT NULL,
    `occurred_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`event_type`,`event_id`)
);
--> statement-breakpoint
CREATE INDEX `analytics_events_occurred_idx` ON `analytics_events` (`occurred_at`);
--> statement-breakpoint
CREATE TABLE `reaction_placements` (
    `guild_id` text NOT NULL,
    `message_id` text NOT NULL,
    `user_id` text NOT NULL,
    `emoji` text NOT NULL,
    `added_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`message_id`,`user_id`,`emoji`)
);
--> statement-breakpoint
CREATE TABLE `level_voice_sessions` (
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `channel_id` text NOT NULL,
    `eligible_since` integer,
    `last_observed_at` integer NOT NULL,
    `remainder_seconds` integer DEFAULT 0 NOT NULL,
    `awarded_xp` integer DEFAULT 0 NOT NULL,
    PRIMARY KEY (`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `member_presence` (
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `present` integer NOT NULL,
    `last_observed_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `event_log_channels` (
    `guild_id` text NOT NULL,
    `module` text NOT NULL,
    `channel_id` text NOT NULL,
    `color` text,
    `created_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`module`,`channel_id`)
);
--> statement-breakpoint
CREATE INDEX `event_log_channels_guild_channel_idx` ON `event_log_channels` (`guild_id`,`channel_id`);
--> statement-breakpoint
CREATE TABLE `event_log_ignores` (
    `guild_id` text NOT NULL,
    `target_type` text NOT NULL,
    `target_id` text NOT NULL,
    `created_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `event_log_outbox` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `guild_id` text NOT NULL,
    `event_key` text NOT NULL,
    `channel_id` text NOT NULL,
    `module` text NOT NULL,
    `payload` text NOT NULL,
    `attempts` integer DEFAULT 0 NOT NULL,
    `next_attempt_at` integer NOT NULL,
    `status` text DEFAULT 'pending' NOT NULL,
    `created_at` integer NOT NULL,
    UNIQUE (`guild_id`,`event_key`,`channel_id`)
);
--> statement-breakpoint
CREATE INDEX `event_log_outbox_due_idx` ON `event_log_outbox` (`status`,`next_attempt_at`);
