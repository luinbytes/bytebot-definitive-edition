CREATE TABLE `automation_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_message_id` text,
	`run_count` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_guild_kind_key_unique` ON `automation_rules` (`guild_id`,`kind`,`key`);
--> statement-breakpoint
CREATE INDEX `automation_due_idx` ON `automation_rules` (`enabled`,`next_run_at`);
--> statement-breakpoint
CREATE INDEX `automation_guild_kind_idx` ON `automation_rules` (`guild_id`,`kind`);
