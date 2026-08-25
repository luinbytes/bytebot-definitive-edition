CREATE TABLE `music_config` (
    `guild_id` text PRIMARY KEY NOT NULL,
    `dj_role_id` text,
    `autoplay` integer DEFAULT 0 NOT NULL
);
