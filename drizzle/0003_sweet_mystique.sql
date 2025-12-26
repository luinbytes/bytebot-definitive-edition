CREATE TABLE `birthdays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `birthdays_guild_month_day_idx` ON `birthdays` (`guild_id`,`month`,`day`);--> statement-breakpoint
CREATE INDEX `birthdays_user_guild_idx` ON `birthdays` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `birthdays_user_id_guild_id_unique` ON `birthdays` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `birthday_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`role_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_check` integer
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`content` text NOT NULL,
	`author_id` text NOT NULL,
	`attachment_urls` text,
	`saved_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`message_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookmarks_user_saved_idx` ON `bookmarks` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_content_idx` ON `bookmarks` (`user_id`,`content`);--> statement-breakpoint
CREATE TABLE `media_gallery_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_capture` integer DEFAULT true NOT NULL,
	`file_types` text DEFAULT 'image,video,audio' NOT NULL,
	`max_file_size_mb` integer DEFAULT 50 NOT NULL,
	`auto_tag_channel` integer DEFAULT true NOT NULL,
	`whitelist_role_ids` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`updated_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `media_config_guild_enabled_idx` ON `media_gallery_config` (`guild_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_gallery_config_guild_id_channel_id_unique` ON `media_gallery_config` (`guild_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`media_url` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`mime_type` text,
	`file_size` integer,
	`width` integer,
	`height` integer,
	`duration` real,
	`description` text,
	`content_preview` text,
	`author_id` text NOT NULL,
	`capture_method` text DEFAULT 'auto' NOT NULL,
	`saved_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`message_deleted` integer DEFAULT false NOT NULL,
	`url_expired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_user_saved_idx` ON `media_items` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `media_guild_saved_idx` ON `media_items` (`guild_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `media_user_type_idx` ON `media_items` (`user_id`,`file_type`);--> statement-breakpoint
CREATE INDEX `media_user_channel_idx` ON `media_items` (`user_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `media_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`tag` text NOT NULL,
	`auto_generated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `media_tags_media_idx` ON `media_tags` (`media_id`);--> statement-breakpoint
CREATE INDEX `media_tags_tag_idx` ON `media_tags` (`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_tags_media_id_tag_unique` ON `media_tags` (`media_id`,`tag`);--> statement-breakpoint
CREATE TABLE `auto_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`trigger` text NOT NULL,
	`response` text NOT NULL,
	`channel_id` text,
	`creator_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cooldown` integer DEFAULT 60,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`require_role_id` text,
	`use_count` integer DEFAULT 0,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`last_used` integer
);
--> statement-breakpoint
CREATE INDEX `autoresponse_guild_enabled_idx` ON `auto_responses` (`guild_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `autoresponse_guild_channel_idx` ON `auto_responses` (`guild_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `starboard_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`threshold` integer DEFAULT 5 NOT NULL,
	`emoji` text DEFAULT '⭐' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `starboard_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`original_message_id` text NOT NULL,
	`original_channel_id` text NOT NULL,
	`starboard_message_id` text,
	`author_id` text NOT NULL,
	`star_count` integer DEFAULT 0 NOT NULL,
	`content` text,
	`image_url` text,
	`posted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `starboard_messages_original_message_id_unique` ON `starboard_messages` (`original_message_id`);--> statement-breakpoint
CREATE INDEX `starboard_guild_starcount_idx` ON `starboard_messages` (`guild_id`,`star_count`);--> statement-breakpoint
CREATE INDEX `starboard_author_guild_idx` ON `starboard_messages` (`author_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text,
	`channel_id` text,
	`message` text NOT NULL,
	`trigger_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reminders_user_active_idx` ON `reminders` (`user_id`,`active`);--> statement-breakpoint
CREATE INDEX `reminders_trigger_idx` ON `reminders` (`trigger_at`,`active`);--> statement-breakpoint
CREATE INDEX `reminders_guild_idx` ON `reminders` (`guild_id`,`active`);--> statement-breakpoint
CREATE TABLE `suggestion_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`review_role_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_anonymous` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`upvotes` integer DEFAULT 0,
	`downvotes` integer DEFAULT 0,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_reason` text,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`anonymous` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `suggestions_guild_status_idx` ON `suggestions` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `suggestions_user_guild_idx` ON `suggestions` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE INDEX `suggestions_guild_upvotes_idx` ON `suggestions` (`guild_id`,`upvotes`);--> statement-breakpoint
CREATE TABLE `activity_streaks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_activity_date` text,
	`total_active_days` integer DEFAULT 0 NOT NULL,
	`freezes_available` integer DEFAULT 1 NOT NULL,
	`last_freeze_reset` integer,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"',
	`updated_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `streaks_guild_current_idx` ON `activity_streaks` (`guild_id`,`current_streak`);--> statement-breakpoint
CREATE INDEX `streaks_guild_longest_idx` ON `activity_streaks` (`guild_id`,`longest_streak`);--> statement-breakpoint
CREATE INDEX `streaks_user_guild_idx` ON `activity_streaks` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_streaks_user_id_guild_id_unique` ON `activity_streaks` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `activity_achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`achievement_id` text NOT NULL,
	`earned_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `achievements_user_guild_idx` ON `activity_achievements` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE INDEX `achievements_type_idx` ON `activity_achievements` (`achievement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_achievements_user_id_guild_id_achievement_id_unique` ON `activity_achievements` (`user_id`,`guild_id`,`achievement_id`);--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`voice_minutes` integer DEFAULT 0 NOT NULL,
	`commands_run` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT '"2025-12-26T20:55:42.370Z"'
);
--> statement-breakpoint
CREATE INDEX `activity_user_guild_date_idx` ON `activity_logs` (`user_id`,`guild_id`,`activity_date`);--> statement-breakpoint
CREATE INDEX `activity_date_idx` ON `activity_logs` (`activity_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_logs_user_id_guild_id_activity_date_unique` ON `activity_logs` (`user_id`,`guild_id`,`activity_date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`timestamp` integer DEFAULT '"2025-12-26T20:55:42.369Z"'
);
--> statement-breakpoint
INSERT INTO `__new_moderation_logs`("id", "guild_id", "target_id", "executor_id", "action", "reason", "timestamp") SELECT "id", "guild_id", "target_id", "executor_id", "action", "reason", "timestamp" FROM `moderation_logs`;--> statement-breakpoint
DROP TABLE `moderation_logs`;--> statement-breakpoint
ALTER TABLE `__new_moderation_logs` RENAME TO `moderation_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_bytepods` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`original_owner_id` text,
	`owner_left_at` integer,
	`reclaim_request_pending` integer DEFAULT false,
	`created_at` integer DEFAULT '"2025-12-26T20:55:42.369Z"'
);
--> statement-breakpoint
INSERT INTO `__new_bytepods`("channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "reclaim_request_pending", "created_at") SELECT "channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "reclaim_request_pending", "created_at" FROM `bytepods`;--> statement-breakpoint
DROP TABLE `bytepods`;--> statement-breakpoint
ALTER TABLE `__new_bytepods` RENAME TO `bytepods`;--> statement-breakpoint
ALTER TABLE `guilds` ADD `welcome_message` text;--> statement-breakpoint
ALTER TABLE `guilds` ADD `welcome_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `guilds` ADD `welcome_use_embed` integer DEFAULT true;