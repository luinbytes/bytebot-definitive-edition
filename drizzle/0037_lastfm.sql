CREATE TABLE `lastfm_accounts` (
    `user_id` text PRIMARY KEY NOT NULL,
    `username` text NOT NULL,
    `session_key` text,
    `presentation` text,
    `reactions` text,
    `command_alias` text,
    `linked_at` integer NOT NULL,
    `refreshed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lastfm_accounts_username_idx` ON `lastfm_accounts` (`username`);
--> statement-breakpoint
CREATE TABLE `lastfm_artists` (
    `user_id` text NOT NULL,
    `artist` text NOT NULL,
    `playcount` integer NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`user_id`, `artist`),
    CONSTRAINT `lastfm_artists_user_fk` FOREIGN KEY (`user_id`) REFERENCES `lastfm_accounts`(`user_id`) ON DELETE CASCADE,
    CONSTRAINT `lastfm_artists_playcount_check` CHECK (`playcount` >= 0)
);
--> statement-breakpoint
CREATE INDEX `lastfm_artists_plays_idx` ON `lastfm_artists` (`artist`,`playcount`);
--> statement-breakpoint
CREATE TABLE `lastfm_oauth_states` (
    `state` text PRIMARY KEY NOT NULL,
    `user_id` text NOT NULL,
    `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lastfm_oauth_states_expiry_idx` ON `lastfm_oauth_states` (`expires_at`);
