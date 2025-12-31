PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`timestamp` integer DEFAULT '"2025-12-31T16:33:28.536Z"'
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
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"'
);
--> statement-breakpoint
INSERT INTO `__new_bytepods`("channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "reclaim_request_pending", "created_at") SELECT "channel_id", "guild_id", "owner_id", "original_owner_id", "owner_left_at", "reclaim_request_pending", "created_at" FROM `bytepods`;--> statement-breakpoint
DROP TABLE `bytepods`;--> statement-breakpoint
ALTER TABLE `__new_bytepods` RENAME TO `bytepods`;--> statement-breakpoint
CREATE TABLE `__new_bytepod_user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`auto_lock` integer DEFAULT false
);
--> statement-breakpoint
INSERT INTO `__new_bytepod_user_settings`("id", "user_id", "guild_id", "auto_lock") SELECT "id", "user_id", "guild_id", "auto_lock" FROM `bytepod_user_settings`;--> statement-breakpoint
DROP TABLE `bytepod_user_settings`;--> statement-breakpoint
ALTER TABLE `__new_bytepod_user_settings` RENAME TO `bytepod_user_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `bytepod_user_settings_user_id_guild_id_unique` ON `bytepod_user_settings` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `__new_birthdays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"'
);
--> statement-breakpoint
INSERT INTO `__new_birthdays`("id", "user_id", "guild_id", "month", "day", "created_at") SELECT "id", "user_id", "guild_id", "month", "day", "created_at" FROM `birthdays`;--> statement-breakpoint
DROP TABLE `birthdays`;--> statement-breakpoint
ALTER TABLE `__new_birthdays` RENAME TO `birthdays`;--> statement-breakpoint
CREATE INDEX `birthdays_guild_month_day_idx` ON `birthdays` (`guild_id`,`month`,`day`);--> statement-breakpoint
CREATE INDEX `birthdays_user_guild_idx` ON `birthdays` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `birthdays_user_id_guild_id_unique` ON `birthdays` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `__new_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`content` text NOT NULL,
	`author_id` text NOT NULL,
	`attachment_urls` text,
	`saved_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"',
	`message_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_bookmarks`("id", "user_id", "guild_id", "channel_id", "message_id", "content", "author_id", "attachment_urls", "saved_at", "message_deleted") SELECT "id", "user_id", "guild_id", "channel_id", "message_id", "content", "author_id", "attachment_urls", "saved_at", "message_deleted" FROM `bookmarks`;--> statement-breakpoint
DROP TABLE `bookmarks`;--> statement-breakpoint
ALTER TABLE `__new_bookmarks` RENAME TO `bookmarks`;--> statement-breakpoint
CREATE INDEX `bookmarks_user_saved_idx` ON `bookmarks` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_content_idx` ON `bookmarks` (`user_id`,`content`);--> statement-breakpoint
CREATE TABLE `__new_media_gallery_config` (
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
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"',
	`updated_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"'
);
--> statement-breakpoint
INSERT INTO `__new_media_gallery_config`("id", "guild_id", "channel_id", "enabled", "auto_capture", "file_types", "max_file_size_mb", "auto_tag_channel", "whitelist_role_ids", "created_by", "created_at", "updated_at") SELECT "id", "guild_id", "channel_id", "enabled", "auto_capture", "file_types", "max_file_size_mb", "auto_tag_channel", "whitelist_role_ids", "created_by", "created_at", "updated_at" FROM `media_gallery_config`;--> statement-breakpoint
DROP TABLE `media_gallery_config`;--> statement-breakpoint
ALTER TABLE `__new_media_gallery_config` RENAME TO `media_gallery_config`;--> statement-breakpoint
CREATE INDEX `media_config_guild_enabled_idx` ON `media_gallery_config` (`guild_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_gallery_config_guild_id_channel_id_unique` ON `media_gallery_config` (`guild_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `__new_media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`archive_message_id` text,
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
	`saved_at` integer DEFAULT '"2025-12-31T16:33:28.536Z"',
	`message_deleted` integer DEFAULT false NOT NULL,
	`url_expired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_media_items`("id", "user_id", "guild_id", "channel_id", "message_id", "archive_message_id", "media_url", "file_name", "file_type", "mime_type", "file_size", "width", "height", "duration", "description", "content_preview", "author_id", "capture_method", "saved_at", "message_deleted", "url_expired") SELECT "id", "user_id", "guild_id", "channel_id", "message_id", "archive_message_id", "media_url", "file_name", "file_type", "mime_type", "file_size", "width", "height", "duration", "description", "content_preview", "author_id", "capture_method", "saved_at", "message_deleted", "url_expired" FROM `media_items`;--> statement-breakpoint
DROP TABLE `media_items`;--> statement-breakpoint
ALTER TABLE `__new_media_items` RENAME TO `media_items`;--> statement-breakpoint
CREATE INDEX `media_user_saved_idx` ON `media_items` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `media_guild_saved_idx` ON `media_items` (`guild_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `media_user_type_idx` ON `media_items` (`user_id`,`file_type`);--> statement-breakpoint
CREATE INDEX `media_user_channel_idx` ON `media_items` (`user_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `__new_media_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`tag` text NOT NULL,
	`auto_generated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_media_tags`("id", "media_id", "tag", "auto_generated", "created_at") SELECT "id", "media_id", "tag", "auto_generated", "created_at" FROM `media_tags`;--> statement-breakpoint
DROP TABLE `media_tags`;--> statement-breakpoint
ALTER TABLE `__new_media_tags` RENAME TO `media_tags`;--> statement-breakpoint
CREATE INDEX `media_tags_media_idx` ON `media_tags` (`media_id`);--> statement-breakpoint
CREATE INDEX `media_tags_tag_idx` ON `media_tags` (`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_tags_media_id_tag_unique` ON `media_tags` (`media_id`,`tag`);--> statement-breakpoint
CREATE TABLE `__new_auto_responses` (
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
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"',
	`last_used` integer
);
--> statement-breakpoint
INSERT INTO `__new_auto_responses`("id", "guild_id", "trigger", "response", "channel_id", "creator_id", "enabled", "cooldown", "match_type", "require_role_id", "use_count", "created_at", "last_used") SELECT "id", "guild_id", "trigger", "response", "channel_id", "creator_id", "enabled", "cooldown", "match_type", "require_role_id", "use_count", "created_at", "last_used" FROM `auto_responses`;--> statement-breakpoint
DROP TABLE `auto_responses`;--> statement-breakpoint
ALTER TABLE `__new_auto_responses` RENAME TO `auto_responses`;--> statement-breakpoint
CREATE INDEX `autoresponse_guild_enabled_idx` ON `auto_responses` (`guild_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `autoresponse_guild_channel_idx` ON `auto_responses` (`guild_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `__new_suggestions` (
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
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"',
	`anonymous` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_suggestions`("id", "guild_id", "user_id", "content", "message_id", "channel_id", "status", "upvotes", "downvotes", "reviewed_by", "reviewed_at", "review_reason", "created_at", "anonymous") SELECT "id", "guild_id", "user_id", "content", "message_id", "channel_id", "status", "upvotes", "downvotes", "reviewed_by", "reviewed_at", "review_reason", "created_at", "anonymous" FROM `suggestions`;--> statement-breakpoint
DROP TABLE `suggestions`;--> statement-breakpoint
ALTER TABLE `__new_suggestions` RENAME TO `suggestions`;--> statement-breakpoint
CREATE INDEX `suggestions_guild_status_idx` ON `suggestions` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `suggestions_user_guild_idx` ON `suggestions` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE INDEX `suggestions_guild_upvotes_idx` ON `suggestions` (`guild_id`,`upvotes`);--> statement-breakpoint
CREATE TABLE `__new_activity_streaks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_activity_date` text,
	`total_active_days` integer DEFAULT 0 NOT NULL,
	`freezes_available` integer DEFAULT 1 NOT NULL,
	`last_freeze_reset` integer,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"',
	`updated_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_activity_streaks`("id", "user_id", "guild_id", "current_streak", "longest_streak", "last_activity_date", "total_active_days", "freezes_available", "last_freeze_reset", "created_at", "updated_at") SELECT "id", "user_id", "guild_id", "current_streak", "longest_streak", "last_activity_date", "total_active_days", "freezes_available", "last_freeze_reset", "created_at", "updated_at" FROM `activity_streaks`;--> statement-breakpoint
DROP TABLE `activity_streaks`;--> statement-breakpoint
ALTER TABLE `__new_activity_streaks` RENAME TO `activity_streaks`;--> statement-breakpoint
CREATE INDEX `streaks_guild_current_idx` ON `activity_streaks` (`guild_id`,`current_streak`);--> statement-breakpoint
CREATE INDEX `streaks_guild_longest_idx` ON `activity_streaks` (`guild_id`,`longest_streak`);--> statement-breakpoint
CREATE INDEX `streaks_user_guild_idx` ON `activity_streaks` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_streaks_user_id_guild_id_unique` ON `activity_streaks` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `__new_activity_achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`achievement_id` text NOT NULL,
	`notified` integer DEFAULT false NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`awarded_by` text,
	`earned_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_activity_achievements`("id", "user_id", "guild_id", "achievement_id", "notified", "points", "awarded_by", "earned_at") SELECT "id", "user_id", "guild_id", "achievement_id", "notified", "points", "awarded_by", "earned_at" FROM `activity_achievements`;--> statement-breakpoint
DROP TABLE `activity_achievements`;--> statement-breakpoint
ALTER TABLE `__new_activity_achievements` RENAME TO `activity_achievements`;--> statement-breakpoint
CREATE INDEX `achievements_user_guild_idx` ON `activity_achievements` (`user_id`,`guild_id`);--> statement-breakpoint
CREATE INDEX `achievements_type_idx` ON `activity_achievements` (`achievement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_achievements_user_id_guild_id_achievement_id_unique` ON `activity_achievements` (`user_id`,`guild_id`,`achievement_id`);--> statement-breakpoint
CREATE TABLE `__new_activity_logs` (
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
	`updated_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_activity_logs`("id", "user_id", "guild_id", "activity_date", "message_count", "voice_minutes", "commands_run", "reactions_given", "channels_joined", "bytepods_created", "unique_commands_used", "active_hours", "first_activity_time", "last_activity_time", "updated_at") SELECT "id", "user_id", "guild_id", "activity_date", "message_count", "voice_minutes", "commands_run", "reactions_given", "channels_joined", "bytepods_created", "unique_commands_used", "active_hours", "first_activity_time", "last_activity_time", "updated_at" FROM `activity_logs`;--> statement-breakpoint
DROP TABLE `activity_logs`;--> statement-breakpoint
ALTER TABLE `__new_activity_logs` RENAME TO `activity_logs`;--> statement-breakpoint
CREATE INDEX `activity_user_guild_date_idx` ON `activity_logs` (`user_id`,`guild_id`,`activity_date`);--> statement-breakpoint
CREATE INDEX `activity_date_idx` ON `activity_logs` (`activity_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_logs_user_id_guild_id_activity_date_unique` ON `activity_logs` (`user_id`,`guild_id`,`activity_date`);--> statement-breakpoint
CREATE TABLE `__new_achievement_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`emoji` text NOT NULL,
	`category` text NOT NULL,
	`rarity` text NOT NULL,
	`check_type` text NOT NULL,
	`criteria` text NOT NULL,
	`grant_role` integer DEFAULT false NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`seasonal` integer DEFAULT false NOT NULL,
	`seasonal_event` text,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_achievement_definitions`("id", "title", "description", "emoji", "category", "rarity", "check_type", "criteria", "grant_role", "points", "start_date", "end_date", "seasonal", "seasonal_event", "created_at") SELECT "id", "title", "description", "emoji", "category", "rarity", "check_type", "criteria", "grant_role", "points", "start_date", "end_date", "seasonal", "seasonal_event", "created_at" FROM `achievement_definitions`;--> statement-breakpoint
DROP TABLE `achievement_definitions`;--> statement-breakpoint
ALTER TABLE `__new_achievement_definitions` RENAME TO `achievement_definitions`;--> statement-breakpoint
CREATE INDEX `achievement_defs_category_idx` ON `achievement_definitions` (`category`);--> statement-breakpoint
CREATE INDEX `achievement_defs_rarity_idx` ON `achievement_definitions` (`rarity`);--> statement-breakpoint
CREATE INDEX `achievement_defs_seasonal_idx` ON `achievement_definitions` (`seasonal`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `__new_achievement_role_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`role_prefix` text DEFAULT '🏆' NOT NULL,
	`use_rarity_colors` integer DEFAULT true NOT NULL,
	`cleanup_orphaned` integer DEFAULT true NOT NULL,
	`notify_on_earn` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"',
	`updated_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_achievement_role_config`("guild_id", "enabled", "role_prefix", "use_rarity_colors", "cleanup_orphaned", "notify_on_earn", "created_at", "updated_at") SELECT "guild_id", "enabled", "role_prefix", "use_rarity_colors", "cleanup_orphaned", "notify_on_earn", "created_at", "updated_at" FROM `achievement_role_config`;--> statement-breakpoint
DROP TABLE `achievement_role_config`;--> statement-breakpoint
ALTER TABLE `__new_achievement_role_config` RENAME TO `achievement_role_config`;--> statement-breakpoint
CREATE TABLE `__new_achievement_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`achievement_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"'
);
--> statement-breakpoint
INSERT INTO `__new_achievement_roles`("id", "achievement_id", "guild_id", "role_id", "created_at") SELECT "id", "achievement_id", "guild_id", "role_id", "created_at" FROM `achievement_roles`;--> statement-breakpoint
DROP TABLE `achievement_roles`;--> statement-breakpoint
ALTER TABLE `__new_achievement_roles` RENAME TO `achievement_roles`;--> statement-breakpoint
CREATE INDEX `achievement_roles_guild_idx` ON `achievement_roles` (`guild_id`);--> statement-breakpoint
CREATE INDEX `achievement_roles_achievement_idx` ON `achievement_roles` (`achievement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `achievement_roles_achievement_id_guild_id_unique` ON `achievement_roles` (`achievement_id`,`guild_id`);--> statement-breakpoint
CREATE TABLE `__new_custom_achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`achievement_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`emoji` text NOT NULL,
	`category` text DEFAULT 'custom' NOT NULL,
	`rarity` text NOT NULL,
	`check_type` text NOT NULL,
	`criteria` text,
	`grant_role` integer DEFAULT false NOT NULL,
	`points` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT '"2025-12-31T16:33:28.537Z"',
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_custom_achievements`("id", "guild_id", "achievement_id", "title", "description", "emoji", "category", "rarity", "check_type", "criteria", "grant_role", "points", "created_by", "created_at", "enabled") SELECT "id", "guild_id", "achievement_id", "title", "description", "emoji", "category", "rarity", "check_type", "criteria", "grant_role", "points", "created_by", "created_at", "enabled" FROM `custom_achievements`;--> statement-breakpoint
DROP TABLE `custom_achievements`;--> statement-breakpoint
ALTER TABLE `__new_custom_achievements` RENAME TO `custom_achievements`;--> statement-breakpoint
CREATE INDEX `custom_achievements_guild_idx` ON `custom_achievements` (`guild_id`);--> statement-breakpoint
CREATE INDEX `custom_achievements_guild_enabled_idx` ON `custom_achievements` (`guild_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_achievements_guild_id_achievement_id_unique` ON `custom_achievements` (`guild_id`,`achievement_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `ephemeral_preference` text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE `bytepod_templates` ADD `guild_id` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bytepod_templates_user_id_guild_id_name_unique` ON `bytepod_templates` (`user_id`,`guild_id`,`name`);