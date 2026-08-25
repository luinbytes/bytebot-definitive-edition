CREATE TABLE `personal_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text,
	`afk_template` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `personal_settings_nonempty_check` CHECK (`timezone` IS NOT NULL OR `afk_template` IS NOT NULL),
	CONSTRAINT `personal_settings_timezone_check` CHECK (`timezone` IS NULL OR length(`timezone`) BETWEEN 1 AND 100),
	CONSTRAINT `personal_settings_template_check` CHECK (`afk_template` IS NULL OR length(`afk_template`) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE `afk_statuses` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`set_at` integer NOT NULL,
	CONSTRAINT `afk_statuses_status_check` CHECK (length(`status`) BETWEEN 1 AND 25)
);
--> statement-breakpoint
CREATE TABLE `diary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `diary_entries_date_check` CHECK (`entry_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT `diary_entries_content_check` CHECK (length(`content`) BETWEEN 1 AND 2000),
	CONSTRAINT `diary_entries_user_date_unique` UNIQUE(`user_id`,`entry_date`)
);
--> statement-breakpoint
CREATE INDEX `diary_entries_user_date_idx` ON `diary_entries` (`user_id`,`entry_date`);
