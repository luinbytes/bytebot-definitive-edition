# Server backups and presentation

ByteBot exposes the formerly paid backup and server-presentation features through the existing `/server` intent hub. These commands have no billing or entitlement checks.

## Backups

`/server backup` provides `create`, `list`, `view`, `rename`, `delete`, and `restore`. Each administrator may keep five named backups per server. Names accept 1–100 characters and descriptions accept up to 500.

A backup stores schema version 1, its source server and creator, timestamps, a SHA-256 payload digest, and these sections:

- non-managed roles, including permissions, order, color, icon, hoist, and mention settings;
- text, voice, category, forum, and stage channels, including parents and permission overwrites;
- custom emojis and stickers; and
- an explicit allowlist of ByteBot configuration tables.

ByteBot excludes messages, webhooks, application commands, global bot branding, Discord server branding/settings, member roles and nicknames, moderation evidence, incidents, activity history, transcripts, live tickets, live giveaways, reminders, and active voice/session state. Scheduler leases and runtime counters are stripped from included automation configuration.

`/server backup restore` defaults to a read-only preview. Choose `merge` to replace matching configuration while retaining unrelated rows, or `destructive` to remove selected current structure before recreation. Section switches select roles, channels, emojis, stickers, or ByteBot configuration. Set `confirm:True` only after checking the preview.

Restore stays in the source server and creator scope. ByteBot checks its current Discord permissions, role hierarchy, blocked-role policy, channel deletability, payload version, and digest before mutation. Role and channel IDs are remapped into channel overwrites and ByteBot configuration. Discord operations report per-item failures; ByteBot configuration restores in one SQLite transaction.

## Per-server ByteBot profile

Only the server owner may run `/server customize`. `name`, `avatar`, `banner`, and `bio` edit ByteBot's current guild-member profile. They do not edit the global application user. `reset` clears those four guild fields.

Nickname length is 32 characters and bio length is 190. Avatar and banner inputs accept PNG, JPG, GIF, or WebP up to 8 MB. URL downloads reject private-network addresses and redirects, stop at 8 MB while streaming, and time out after 10 seconds.

`/server customize preset` uses an `action` choice because Discord cannot register a third command token. `create`, `list`, `apply`, and `remove` cover the pinned Greed preset paths. A server may keep 10 presets with names up to 50 characters. Apply and remove show a preview until `confirm:True` is supplied.

## ByteBot discovery

`/server discovery publish` opts the server into ByteBot's directory. Manage Server is required. ByteBot verifies that the supplied Discord invite belongs to the current server, then stores only the server ID, name, icon, chosen description, approximate member count, invite, up to five public tags, and optional banner. Re-running `publish` updates the listing.

`list` and `view` are public read-only paths. `bump` requires Manage Server and permits one bump per hour. `remove` withdraws consent after confirmation. Listings never include private channels, members, roles, owner identity, moderation/security settings, message content, analytics detail, or integrations. ByteBot discovery does not enroll a server in Discord's native discovery directory.

## Server statistics card

`/server stats` and its `/stats server` handler render the existing Discord embed card. The optional `days` range accepts 1–1095 days. The range field sums persisted messages, reactions, voice minutes, and commands for this server. Current Discord structure and ByteBot counts remain visible. ByteBot does not invent historical joins, leaves, or metrics that it never stored.

Greed's public sources do not define its discovery slash command, listing schema, stats-card layout, or card font/effect values. ByteBot labels its directory as ByteBot-owned and keeps fixed embed styling until a first-party source defines those missing details. See [the source contract](../research/greed-backup-customization-discovery-contract.md).
