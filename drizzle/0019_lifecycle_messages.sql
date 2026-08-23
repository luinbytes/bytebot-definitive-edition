CREATE TABLE `lifecycle_messages` (
	`guild_id` text NOT NULL,
	`type` text NOT NULL,
	`channel_id` text,
	`template` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`format` text DEFAULT 'embed' NOT NULL,
	`delete_after_seconds` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `type`)
);
