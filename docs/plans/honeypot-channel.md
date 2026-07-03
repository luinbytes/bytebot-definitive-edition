# Honeypot Channel Implementation Plan

Build a Discord honeypot that creates a fixed `dangerous` category with a `danger` text channel. Any non-exempt member who posts in `#danger` has the message deleted and is banned immediately. The public channel contains a pinned warning and a `Honeypot Shame Board` showing the 10 most recent successful honeypot bans.

See also:
- `CONTEXT.md` for honeypot language.
- `docs/adr/0001-honeypot-disable-tears-down-channel.md` for the disable teardown decision.

## Decisions

- Setup creates both category `dangerous` and channel `danger`.
- Setup uses fixed names only.
- Everyone can view and send in `#danger`; enforcement handles posts after they land.
- Setup preflights bot permissions: `ManageChannels`, `SendMessages`, `EmbedLinks`, `ManageMessages`, and `BanMembers`.
- Setup only saves enabled config after category, channel, warning message, and Shame Board message are created.
- Pinning the warning is attempted; pin failure warns but does not fail setup.
- If setup message creation fails, clean up newly-created category/channel.
- If an existing setup or fixed-name conflict exists, show a 120-second user-limited overwrite/cancel confirmation.
- Overwrite deletes configured objects plus fixed-name conflicts before creating the new setup. It preserves incidents and exemptions.
- Disable uses a 120-second user-limited confirmation, disables config, clears object/message IDs, deletes configured category/channel if present, and preserves incidents/exemptions.
- If disable objects are already gone, report that and still clear config.
- Setup/disable/exemption changes log to `guilds.logChannel` when configured and sendable. Log send failure does not fail commands.
- No `/server` aliases for v1.

## Commands

Create `src/commands/administration/honeypot.js` with `ManageGuild` runtime permissions and Discord UI defaults:

- `/honeypot setup`
- `/honeypot disable`
- `/honeypot configure view`
- `/honeypot configure exempt-user-add user:@user`
- `/honeypot configure exempt-user-remove user:@user`
- `/honeypot configure exempt-role-add role:@role`
- `/honeypot configure exempt-role-remove role:@role`

Behavior:
- Exemption add/remove is a friendly no-op when already present/missing.
- `@everyone` cannot be exempted.
- Managed/integration roles can be exempted.
- `configure view` resolves channels/messages/users/roles where possible and falls back to IDs.
- `configure view` shows bot permission health and warns if `#danger` is no longer under `dangerous`.
- `configure view` reports missing warning/Shame Board messages; it does not repair them.

## Database

Add Drizzle schema and expected schema entries:

- `honeypot_config`
  - `guild_id` primary key
  - `category_id`
  - `channel_id` unique/indexed
  - `warning_message_id`
  - `shame_board_message_id`
  - `enabled`
  - `pin_warning_failed`
  - `created_at`
  - `updated_at`
- `honeypot_exempt_users`
  - `guild_id`
  - `user_id`
- `honeypot_exempt_roles`
  - `guild_id`
  - `role_id`
- `honeypot_incidents`
  - `id`
  - `guild_id`
  - `user_id`
  - `username`
  - `display_name`
  - `message_id`
  - `channel_id`
  - `snippet`
  - `attachment_summary`
  - `status`
  - `failure_reason`
  - `account_created_at`
  - `joined_at`
  - `triggered_at`

## Enforcement

Add a small utility, likely `src/utils/honeypotUtil.js`, called at the top of `src/events/messageCreate.js` before auto-responder and activity tracking.

Rules:
- Ignore DMs, bot authors, system messages, and webhooks.
- Query enabled config by `channelId`.
- Only `messageCreate` triggers enforcement. Reactions and edits do not.
- Exemptions:
  - server owner
  - `Administrator`
  - `ModerateMembers`
  - `ManageMessages`
  - configured exempt user
  - configured exempt role by current membership
- Exempt messages are deleted without banning and do not count for activity.
- Non-exempt messages are deleted, then the user is banned immediately.
- If the member left, attempt `guild.members.ban(userId, ...)` and record `banned_left_server` on success.
- Ban with `deleteMessageSeconds: 7 * 24 * 60 * 60`.
- No DM before banning.
- Ban reason format: `Honeypot trap triggered in #danger: "<snippet>"`, safely truncated under Discord audit-log limits.
- Sanitized snippet is capped around 120 chars with URLs replaced.
- Attachments are summarized by count/type only; no URLs/previews.
- Write standard `moderation_logs` action `BAN` for successful bans.
- Write honeypot incident rows for success and failure.
- Failed bans delete the message if possible, log the failure, and alert mod logs if possible. Failed bans do not appear on the public Shame Board and do not count in the public total.

## Channel Messages

Warning:
- Normal bot-authored embed.
- Stern, close to the screenshot, polished.
- Says `DO NOT POST HERE`, explains instant ban and honeypot purpose.
- Pinned if possible.
- Channel topic: `Do not post here. Posts in this honeypot channel are automatically banned.`

Shame Board:
- Normal bot-authored embed below the warning.
- Title: `Honeypot Shame Board`.
- Public in `#danger`.
- Shows 10 most recent successful honeypot bans, most recent first.
- Counts only successful bans, including `banned_left_server`.
- Shows account age and join age with Discord relative timestamps.
- Shows sanitized snippets and attachment summaries.
- Footer includes last updated and `Posts here are automatically banned.`
- Board update failures never block banning; log and mod-log alert if possible.
