CREATE TABLE `economy_game_sessions` (
    `id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `scope_type` text DEFAULT 'guild' NOT NULL,
    `scope_id` text NOT NULL,
    `user_id` text NOT NULL,
    `game` text NOT NULL,
    `bet` integer NOT NULL,
    `state_json` text DEFAULT '{}' NOT NULL,
    `status` text NOT NULL,
    `nonce` text NOT NULL,
    `transaction_id` text NOT NULL,
    `created_at` integer NOT NULL,
    `expires_at` integer NOT NULL,
    `settled_at` integer,
    `settlement_amount` integer,
    CONSTRAINT `economy_game_sessions_scope_check` CHECK (`scope_type` = 'guild' AND `scope_id` = `guild_id`),
    CONSTRAINT `economy_game_sessions_bet_check` CHECK (`bet` BETWEEN 10 AND 1000000),
    CONSTRAINT `economy_game_sessions_game_check` CHECK (`game` IN ('coinflip','dice','gamble','roulette','highlow','slots','plinko','bombs','ladder','crash','scratch','blackjack')),
    CONSTRAINT `economy_game_sessions_status_check` CHECK (`status` IN ('active','won','lost','cashed_out','refunded','forfeited'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_game_sessions_one_active` ON `economy_game_sessions` (`guild_id`,`user_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `economy_game_sessions_active_expiry_idx` ON `economy_game_sessions` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `economy_gangs` (
    `id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `name` text NOT NULL,
    `owner_id` text NOT NULL,
    `banner_url` text,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_gangs_name_unique` ON `economy_gangs` (`guild_id`,`name`);
--> statement-breakpoint
CREATE TABLE `economy_gang_members` (
    `guild_id` text NOT NULL,
    `gang_id` text,
    `user_id` text NOT NULL,
    `role` text NOT NULL,
    `joined_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`,`user_id`),
    CONSTRAINT `economy_gang_members_gang_fk` FOREIGN KEY (`gang_id`) REFERENCES `economy_gangs`(`id`) ON DELETE CASCADE,
    CONSTRAINT `economy_gang_members_role_check` CHECK (`role` IN ('owner','admin','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_gang_members_one_owner` ON `economy_gang_members` (`gang_id`) WHERE `role` = 'owner';
--> statement-breakpoint
CREATE INDEX `economy_gang_members_gang_idx` ON `economy_gang_members` (`gang_id`,`joined_at`);
--> statement-breakpoint
CREATE TABLE `economy_gang_invites` (
    `id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `gang_id` text NOT NULL,
    `inviter_id` text NOT NULL,
    `invitee_id` text NOT NULL,
    `status` text DEFAULT 'pending' NOT NULL,
    `nonce` text NOT NULL,
    `created_at` integer NOT NULL,
    `expires_at` integer NOT NULL,
    `acted_at` integer,
    CONSTRAINT `economy_gang_invites_gang_fk` FOREIGN KEY (`gang_id`) REFERENCES `economy_gangs`(`id`) ON DELETE SET NULL,
    CONSTRAINT `economy_gang_invites_status_check` CHECK (`status` IN ('pending','accepted','declined','expired','revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_gang_invites_one_pending` ON `economy_gang_invites` (`guild_id`,`gang_id`,`invitee_id`) WHERE `status` = 'pending';
--> statement-breakpoint
CREATE TABLE `economy_labs` (
    `id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `level` integer DEFAULT 1 NOT NULL,
    `ampoules` integer DEFAULT 1 NOT NULL,
    `stored_amount` integer DEFAULT 0 NOT NULL,
    `storage_cap` integer DEFAULT 1000 NOT NULL,
    `last_accrual_at` integer NOT NULL,
    `paused_at` integer,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    CONSTRAINT `economy_labs_level_check` CHECK (`level` BETWEEN 1 AND 10),
    CONSTRAINT `economy_labs_ampoules_check` CHECK (`ampoules` BETWEEN 1 AND 5),
    CONSTRAINT `economy_labs_storage_check` CHECK (`storage_cap` = `level` * 1000 AND `stored_amount` BETWEEN 0 AND `storage_cap`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_labs_owner_unique` ON `economy_labs` (`guild_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `economy_lab_operations` (
    `operation_id` text PRIMARY KEY NOT NULL,
    `lab_id` text,
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `kind` text NOT NULL,
    `input_amount` integer DEFAULT 0 NOT NULL,
    `result_amount` integer DEFAULT 0 NOT NULL,
    `result_json` text NOT NULL,
    `created_at` integer NOT NULL,
    CONSTRAINT `economy_lab_operations_lab_fk` FOREIGN KEY (`lab_id`) REFERENCES `economy_labs`(`id`) ON DELETE SET NULL,
    CONSTRAINT `economy_lab_operations_kind_check` CHECK (`kind` IN ('buy','upgrade','ampoules','collect')),
    CONSTRAINT `economy_lab_operations_amount_check` CHECK (`input_amount` >= 0 AND `result_amount` >= 0)
);
--> statement-breakpoint
CREATE INDEX `economy_lab_operations_actor_idx` ON `economy_lab_operations` (`guild_id`,`user_id`,`created_at`);
