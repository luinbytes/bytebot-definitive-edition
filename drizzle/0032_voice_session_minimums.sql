ALTER TABLE `level_voice_sessions` ADD `eligible_seconds` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `level_voice_sessions` ADD `xp_seconds_consumed` integer DEFAULT 0 NOT NULL;
