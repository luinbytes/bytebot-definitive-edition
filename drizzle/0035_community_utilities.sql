CREATE TABLE `confession_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`panel_message_id` text,
	`up_emoji` text DEFAULT '👍' NOT NULL,
	`down_emoji` text DEFAULT '👎' NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `confession_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `confession_categories_guild_id_name_key_unique` UNIQUE(`guild_id`,`name_key`)
);
--> statement-breakpoint
CREATE TABLE `confession_blacklist` (
	`guild_id` text NOT NULL,
	`phrase` text NOT NULL,
	`phrase_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `phrase_key`)
);
--> statement-breakpoint
CREATE TABLE `confession_mutes` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`muted_by` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `confessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`number` integer NOT NULL,
	`category_id` integer,
	`channel_id` text NOT NULL,
	`message_id` text,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `confessions_guild_id_number_unique` UNIQUE(`guild_id`,`number`),
	CONSTRAINT `confessions_status_check` CHECK(`status` IN ('pending','published','failed')),
	FOREIGN KEY (`category_id`) REFERENCES `confession_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `confessions_author_created_idx` ON `confessions` (`guild_id`,`author_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `confession_replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`confession_id` integer NOT NULL,
	`replier_id` text NOT NULL,
	`content` text NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`confession_id`) REFERENCES `confessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `confession_replies_created_idx` ON `confession_replies` (`confession_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `community_polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`creator_id` text NOT NULL,
	`question` text NOT NULL,
	`options_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ends_at` integer,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	CONSTRAINT `community_polls_guild_id_message_id_unique` UNIQUE(`guild_id`,`message_id`),
	CONSTRAINT `community_polls_status_check` CHECK(`status` IN ('pending','active','ending','ended','failed'))
);
--> statement-breakpoint
CREATE INDEX `community_polls_due_idx` ON `community_polls` (`status`,`ends_at`);
--> statement-breakpoint
CREATE TABLE `community_poll_votes` (
	`poll_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`option_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `user_id`),
	CONSTRAINT `community_poll_votes_option_check` CHECK(`option_index` BETWEEN 0 AND 9),
	FOREIGN KEY (`poll_id`) REFERENCES `community_polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_only_channels` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `channel_id`)
);
