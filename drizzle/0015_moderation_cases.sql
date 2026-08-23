CREATE TABLE `moderation_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`case_number` integer NOT NULL,
	`target_id` text NOT NULL,
	`executor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`duration_ms` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`undone_by` text,
	`undo_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_cases_guild_id_case_number_unique` ON `moderation_cases` (`guild_id`,`case_number`);
--> statement-breakpoint
CREATE INDEX `moderation_cases_guild_target_idx` ON `moderation_cases` (`guild_id`,`target_id`,`case_number`);
--> statement-breakpoint
CREATE INDEX `moderation_cases_guild_executor_idx` ON `moderation_cases` (`guild_id`,`executor_id`,`case_number`);
--> statement-breakpoint
CREATE TABLE `moderation_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`next_case_number` integer DEFAULT 1 NOT NULL,
	`log_channel_id` text,
	`image_mute_role_id` text,
	`reaction_mute_role_id` text,
	`jail_role_id` text,
	`jail_channel_id` text,
	`managed_resources` text,
	`setup_status` text
);
--> statement-breakpoint
CREATE TABLE `moderation_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`action` text NOT NULL,
	`message_type` text NOT NULL,
	`template` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moderation_hardbans` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`case_number` integer NOT NULL,
	`reason` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `moderation_jail_state` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`case_number` integer NOT NULL,
	`previous_role_ids` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_templates_guild_id_action_message_type_unique` ON `moderation_templates` (`guild_id`,`action`,`message_type`);
--> statement-breakpoint
CREATE TABLE `moderation_staff_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_staff_roles_guild_id_role_id_unique` ON `moderation_staff_roles` (`guild_id`,`role_id`);
--> statement-breakpoint
CREATE TABLE `warning_punishments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`threshold` integer NOT NULL,
	`action` text NOT NULL,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warning_punishments_guild_id_threshold_unique` ON `warning_punishments` (`guild_id`,`threshold`);
--> statement-breakpoint
INSERT INTO `moderation_cases`
	(`guild_id`,`case_number`,`target_id`,`executor_id`,`action`,`reason`,`status`,`created_at`,`updated_at`)
SELECT
	`guild_id`,
	ROW_NUMBER() OVER (PARTITION BY `guild_id` ORDER BY `timestamp`,`id`),
	`target_id`,`executor_id`,`action`,`reason`,'completed',
	COALESCE(`timestamp`, 0),COALESCE(`timestamp`, 0)
FROM `moderation_logs`;
--> statement-breakpoint
INSERT INTO `moderation_config` (`guild_id`,`next_case_number`)
SELECT `guild_id`, COUNT(*) + 1 FROM `moderation_cases` GROUP BY `guild_id`;
