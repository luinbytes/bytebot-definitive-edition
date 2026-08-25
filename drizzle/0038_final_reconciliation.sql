CREATE TABLE `uwu_roulette_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`percentage` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `uwu_roulette_configs_percentage_check` CHECK (`percentage` BETWEEN 1 AND 100)
);
