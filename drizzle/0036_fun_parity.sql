CREATE TABLE `snipe_protections` (
    `user_id` text PRIMARY KEY NOT NULL,
    `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roleplay_disabled` (
    `guild_id` text NOT NULL,
    `action` text NOT NULL,
    `updated_by` text NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`, `action`)
);
--> statement-breakpoint
CREATE TABLE `roleplay_counts` (
    `guild_id` text NOT NULL,
    `actor_id` text NOT NULL,
    `target_id` text NOT NULL,
    `action` text NOT NULL,
    `count` integer DEFAULT 0 NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`guild_id`, `actor_id`, `target_id`, `action`)
);
--> statement-breakpoint
CREATE TABLE `fun_blunts` (
    `user_id` text PRIMARY KEY NOT NULL,
    `sparked_at` integer,
    `last_sparked_at` integer,
    `taps` integer DEFAULT 0 NOT NULL,
    `updated_at` integer NOT NULL,
    CONSTRAINT `fun_blunts_taps_check` CHECK (`taps` >= 0)
);
--> statement-breakpoint
CREATE TABLE `fun_vapes` (
    `guild_id` text PRIMARY KEY NOT NULL,
    `holder_id` text NOT NULL,
    `flavor` text DEFAULT 'mint' NOT NULL,
    `hits` integer DEFAULT 0 NOT NULL,
    `updated_at` integer NOT NULL,
    CONSTRAINT `fun_vapes_hits_check` CHECK (`hits` >= 0)
);
