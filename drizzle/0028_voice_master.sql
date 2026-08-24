CREATE TABLE `voice_master_configs` (
    `guild_id` text PRIMARY KEY NOT NULL,
    `state` text DEFAULT 'active' NOT NULL,
    `generation` integer DEFAULT 0 NOT NULL,
    `category_id` text,
    `primary_channel_id` text,
    `interface_message_id` text,
    `name_template` text DEFAULT '{owner}''s channel' NOT NULL,
    `default_role_id` text,
    `default_bitrate` integer,
    `default_region` text,
    `send_interface` integer DEFAULT 1 NOT NULL,
    `temporary_enabled` integer DEFAULT 1 NOT NULL,
    `join_role_id` text,
    `updated_at` integer NOT NULL,
    CONSTRAINT `voice_master_configs_state_check` CHECK (`state` IN ('creating','active','resetting','failed')),
    CONSTRAINT `voice_master_configs_template_check` CHECK (length(`name_template`) BETWEEN 1 AND 32),
    CONSTRAINT `voice_master_configs_bitrate_check` CHECK (`default_bitrate` IS NULL OR `default_bitrate` >= 8000)
);
--> statement-breakpoint
CREATE TABLE `voice_master_sources` (
    `channel_id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `category_id` text,
    `interface_message_id` text,
    `state` text DEFAULT 'active' NOT NULL,
    `is_primary` integer DEFAULT 0 NOT NULL,
    `owned` integer DEFAULT 0 NOT NULL,
    `created_at` integer NOT NULL,
    CONSTRAINT `voice_master_sources_state_check` CHECK (`state` IN ('active','lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_master_sources_primary_unique` ON `voice_master_sources` (`guild_id`) WHERE `is_primary` = 1;
--> statement-breakpoint
CREATE INDEX `voice_master_sources_guild_idx` ON `voice_master_sources` (`guild_id`,`channel_id`);
--> statement-breakpoint
CREATE TABLE `voice_master_creations` (
    `guild_id` text NOT NULL,
    `source_channel_id` text NOT NULL,
    `member_id` text NOT NULL,
    `channel_id` text,
    `state` text NOT NULL,
    `generation` integer DEFAULT 0 NOT NULL,
    `error` text,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`source_channel_id`,`member_id`),
    CONSTRAINT `voice_master_creations_state_check` CHECK (`state` IN ('pending','active','failed'))
);
--> statement-breakpoint
CREATE TABLE `voice_master_access` (
    `guild_id` text NOT NULL,
    `channel_id` text NOT NULL,
    `user_id` text NOT NULL,
    `effect` text NOT NULL,
    `state` text DEFAULT 'active' NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`channel_id`,`user_id`),
    CONSTRAINT `voice_master_access_effect_check` CHECK (`effect` IN ('permit','reject')),
    CONSTRAINT `voice_master_access_state_check` CHECK (`state` IN ('pending','active'))
);
--> statement-breakpoint
CREATE TABLE `voice_master_join_roles` (
    `guild_id` text NOT NULL,
    `channel_id` text NOT NULL,
    `member_id` text NOT NULL,
    `role_id` text NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`channel_id`,`member_id`)
);
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `source_channel_id` text;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `state` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `generation` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `cleanup_after` integer;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `bot_owned` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `pending_owner_id` text;
--> statement-breakpoint
ALTER TABLE `bytepods` ADD `claim_snapshot` text;
--> statement-breakpoint
CREATE INDEX `bytepods_guild_state_idx` ON `bytepods` (`guild_id`,`state`);
