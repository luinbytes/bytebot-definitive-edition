CREATE TABLE `command_access_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`command_path` text NOT NULL,
	`effect` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_access_rules_guild_id_command_path_effect_scope_type_scope_id_unique` ON `command_access_rules` (`guild_id`,`command_path`,`effect`,`scope_type`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `command_access_rules_guild_command_idx` ON `command_access_rules` (`guild_id`,`command_path`);
--> statement-breakpoint
CREATE TABLE `fake_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`permission` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fake_permissions_guild_id_role_id_permission_unique` ON `fake_permissions` (`guild_id`,`role_id`,`permission`);
--> statement-breakpoint
CREATE INDEX `fake_permissions_guild_role_idx` ON `fake_permissions` (`guild_id`,`role_id`);
--> statement-breakpoint
CREATE TABLE `denied_role_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`permission` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `denied_role_permissions_guild_id_permission_unique` ON `denied_role_permissions` (`guild_id`,`permission`);
--> statement-breakpoint
CREATE INDEX `denied_role_permissions_guild_idx` ON `denied_role_permissions` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `protected_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protected_targets_guild_id_target_type_target_id_unique` ON `protected_targets` (`guild_id`,`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `protected_targets_guild_type_idx` ON `protected_targets` (`guild_id`,`target_type`);
