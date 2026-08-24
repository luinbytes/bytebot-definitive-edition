CREATE TABLE IF NOT EXISTS `member_levels` (
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `xp` integer DEFAULT 0 NOT NULL,
    `level` integer DEFAULT 0 NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `text_xp` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `voice_xp` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `manual_adjustment` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `level_floor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `message_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `voice_seconds` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `member_levels` ADD `last_text_xp_at` integer;
--> statement-breakpoint
UPDATE `member_levels`
SET `manual_adjustment` = `xp`, `level_floor` = `level`;
