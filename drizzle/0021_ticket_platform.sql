CREATE TABLE `ticket_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`default_category_id` text,
	`support_role_id` text,
	`opening_message` text DEFAULT 'Thanks for contacting support.' NOT NULL,
	`button_label` text DEFAULT 'Create ticket' NOT NULL,
	`button_style` text DEFAULT 'primary' NOT NULL,
	`dms_enabled` integer DEFAULT false NOT NULL,
	`inactivity_hours` integer,
	`limit_mode` text DEFAULT 'one_total' NOT NULL,
	`log_channel_id` text,
	`ratings_enabled` integer DEFAULT false NOT NULL,
	`vouch_channel_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticket_panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text DEFAULT 'dropdown' NOT NULL,
	`default_category_id` text,
	`message_script` text,
	`channel_id` text,
	`message_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `ticket_panels_guild_id_name_unique` UNIQUE(`guild_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `ticket_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_id` text,
	`embed_script` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `ticket_topics_guild_id_name_unique` UNIQUE(`guild_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `ticket_topic_roles` (
	`topic_id` integer NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `role_id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_forms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`panel_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `ticket_forms_panel_id_name_unique` UNIQUE(`panel_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `ticket_form_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`label` text NOT NULL,
	`type` text DEFAULT 'short' NOT NULL,
	`placeholder` text,
	`required` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `ticket_form_fields_form_id_position_unique` UNIQUE(`form_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ticket_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`panel_id` integer NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`emoji` text,
	`style` text DEFAULT 'primary' NOT NULL,
	`category_id` text,
	`topic_id` integer,
	`form_id` integer,
	`close_on_leave` integer DEFAULT false NOT NULL,
	`trainee_claim` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `ticket_options_panel_id_position_unique` UNIQUE(`panel_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ticket_option_roles` (
	`option_id` integer NOT NULL,
	`role_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`option_id`, `role_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `ticket_blacklist` (
	`guild_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `target_type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_profiles` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`greeting` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`number` integer NOT NULL,
	`opener_id` text NOT NULL,
	`panel_id` integer,
	`option_id` integer,
	`topic_id` integer,
	`topic_name` text,
	`channel_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimer_id` text,
	`reason` text,
	`form_snapshot` text,
	`access_snapshot` text,
	`inactivity_deadline` integer,
	`warned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	`deleted_at` integer,
	CONSTRAINT `tickets_guild_id_number_unique` UNIQUE(`guild_id`,`number`),
	CONSTRAINT `tickets_channel_id_unique` UNIQUE(`channel_id`)
);
--> statement-breakpoint
CREATE INDEX `tickets_guild_opener_status_idx` ON `tickets` (`guild_id`,`opener_id`,`status`);
--> statement-breakpoint
CREATE INDEX `tickets_inactivity_deadline_idx` ON `tickets` (`inactivity_deadline`,`status`);
--> statement-breakpoint
CREATE TABLE `ticket_members` (
	`ticket_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`ticket_id`, `target_type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ticket_actions_ticket_idx` ON `ticket_actions` (`ticket_id`,`id`);
--> statement-breakpoint
CREATE TABLE `ticket_transcripts` (
	`ticket_id` integer PRIMARY KEY NOT NULL,
	`html` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticket_ratings` (
	`ticket_id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stars` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL
);
