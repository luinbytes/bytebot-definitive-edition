ALTER TABLE `level_live_boards` ADD `create_token` text;
--> statement-breakpoint
ALTER TABLE `level_live_boards` ADD `create_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `level_live_boards` ADD `create_started_at` integer;
--> statement-breakpoint
CREATE TABLE `level_role_jobs` (
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `attempts` integer DEFAULT 0 NOT NULL,
    `generation` integer DEFAULT 1 NOT NULL,
    `claim_token` text,
    `claim_expires_at` integer,
    `next_attempt_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `level_role_jobs_due_idx` ON `level_role_jobs` (`next_attempt_at`);
