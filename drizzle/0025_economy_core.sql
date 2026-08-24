CREATE TABLE `economy_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`currency_name` text DEFAULT 'coins' NOT NULL,
	`currency_emoji` text DEFAULT '🪙' NOT NULL,
	`starting_balance` integer DEFAULT 0 NOT NULL,
	`daily_cap` integer DEFAULT 50000 NOT NULL,
	`preset` text DEFAULT 'standard' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `economy_modes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`scope_type` text DEFAULT 'guild' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `economy_scope_totals` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`minted_text` text DEFAULT '0' NOT NULL,
	`destroyed_text` text DEFAULT '0' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE TABLE `economy_accounts` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wallet` integer DEFAULT 0 NOT NULL,
	`bank` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `economy_accounts_wallet_check` CHECK (`wallet` BETWEEN 0 AND 1000000000000),
	CONSTRAINT `economy_accounts_bank_check` CHECK (`bank` BETWEEN 0 AND 1000000000000),
	PRIMARY KEY (`scope_type`, `scope_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `economy_accounts_rank_idx` ON `economy_accounts` (`scope_type`, `scope_id`, `wallet`, `bank`);
--> statement-breakpoint
CREATE TABLE `economy_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wallet_delta` integer DEFAULT 0 NOT NULL,
	`bank_delta` integer DEFAULT 0 NOT NULL,
	`supply_delta` integer DEFAULT 0 NOT NULL,
	`wallet_balance` integer NOT NULL,
	`bank_balance` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`counterparty_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `economy_ledger_wallet_balance_check` CHECK (`wallet_balance` BETWEEN 0 AND 1000000000000),
	CONSTRAINT `economy_ledger_bank_balance_check` CHECK (`bank_balance` BETWEEN 0 AND 1000000000000)
);
--> statement-breakpoint
CREATE INDEX `economy_ledger_transaction_idx` ON `economy_ledger` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `economy_ledger_account_idx` ON `economy_ledger` (`scope_type`, `scope_id`, `user_id`, `id`);
--> statement-breakpoint
CREATE TABLE `economy_earned_totals` (
	`user_id` text NOT NULL,
	`utc_day` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `utc_day`)
);
--> statement-breakpoint
CREATE TABLE `economy_earning_guilds` (
	`user_id` text NOT NULL,
	`utc_day` text NOT NULL,
	`guild_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `utc_day`, `guild_id`)
);
--> statement-breakpoint
CREATE TABLE `economy_action_cooldowns` (
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`available_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `action`, `scope_type`, `scope_id`, `subject_id`)
);
--> statement-breakpoint
CREATE TABLE `economy_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`minimum` integer NOT NULL,
	`maximum` integer NOT NULL,
	`cooldown_seconds` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_jobs_name_unique` ON `economy_jobs` (`guild_id`, `name`);
--> statement-breakpoint
CREATE TABLE `economy_shop_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`role_name` text NOT NULL,
	`price` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_shop_items_role_unique` ON `economy_shop_items` (`guild_id`, `role_id`);
--> statement-breakpoint
CREATE TABLE `economy_shop_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`reversal_transaction_id` text,
	`guild_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`role_id` text NOT NULL,
	`price` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`delivered_at` integer,
	`reversed_at` integer
);
--> statement-breakpoint
CREATE INDEX `economy_shop_purchases_pending_idx` ON `economy_shop_purchases` (`status`, `guild_id`, `id`);
