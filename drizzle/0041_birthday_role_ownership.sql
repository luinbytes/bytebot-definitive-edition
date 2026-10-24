CREATE TABLE IF NOT EXISTS `birthday_role_grants` (
    `id` text PRIMARY KEY NOT NULL,
    `guild_id` text NOT NULL,
    `user_id` text NOT NULL,
    `role_id` text NOT NULL,
    `joined_at` integer NOT NULL,
    `expires_at` integer NOT NULL,
    `state` text NOT NULL,
    CONSTRAINT `birthday_role_grants_state_check` CHECK (`state` IN ('pending', 'granted')),
    UNIQUE (`guild_id`, `user_id`, `role_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `birthday_role_grants_expiry_idx` ON `birthday_role_grants` (`expires_at`);
