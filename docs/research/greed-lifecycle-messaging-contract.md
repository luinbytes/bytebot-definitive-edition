# Greed lifecycle messaging contract

Researched 2026-08-23 and refreshed 2026-08-25 from the current public [Welcome](https://greed.best/docs/server-configuration/automation/welcome), [Leave](https://greed.best/docs/server-configuration/automation/leave), [Join DM](https://greed.best/docs/configuration/join-dm), and [AutoPFP](https://greed.best/docs/configuration/autopfp) guides, Discord's [Guild resource](https://discord.com/developers/docs/resources/guild), and the official English registry at [`greedbest/i18n@3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/server). The former System Messages URL now returns 404; the pinned registry plus Discord's native system-channel flags are the retained source boundary.

## Public surface

- Welcome and goodbye expose setup, channel, message, test, view, and reset.
- `preview` is a compatible alias of `test`. Multi-channel management exposes add, remove, list, and a channel-specific message; the first added destination becomes primary and a destination without an override falls back to the primary template.
- Goodbye message configuration exposes optional auto-delete from 1 through 30 seconds.
- Boost exposes channel, message, variables, view/settings, and remove.
- Discord-native system messages expose channel removal/selection plus welcome, boost, and welcome-sticker toggles.
- Custom templates support variables and embedded or plain presentation. ByteBot supports the public `$v` embed directives for content, titles, descriptions, colors, URLs, images, thumbnails, timestamps, authors, fields, footers, and buttons. Ordinary non-link display buttons remain disabled; buttons that explicitly name an existing saved custom script stay interactive and carry a guild-bound ID, including in Join DMs.

ByteBot presents the custom surfaces as `/server welcome`, `/server goodbye`, and `/server boost`; Discord-native settings live under `/server system`. Each custom group uses `setup`, `channel`, `message`, `enable`, `disable`, `format`, `variables`, `test`, `preview`, `view`, and `reset`. Join DM maps its public root into `/server welcome dm action:toggle|enable|disable|message|config|view|settings|show|test|preview|reset|clear text:<script>` because Discord permits only one subcommand nesting level. Every documented action and alias remains visible as an action choice. The conflicting hosted boost guide and pinned registry are reconciled explicitly: boost also exposes pinned `settings` and `remove`, while retaining hosted `setup`, `test`, and `reset`.

## Variables and safety

Lifecycle templates use the existing bounded rich-content engine, including embeds, Components V2, saved custom scripts, case-insensitive equality and numeric comparison conditionals, falsy checks, `lower(...)`, and Discord timestamp suffixes. The current user/member, guild, and channel variables are exposed with their documented meanings: `{user}` is the global username while `{user.mention}` is the mention; role name/mention lists, top role, color, join position, guild avatar/boost fields, formatted member/emoji/role counts, and channel name/mention/topic are included. Legacy ByteBot aliases remain compatible.

Templates are validated before storage. Unknown variables are rejected. Message sends disable broad role/everyone parsing and permit only the lifecycle member's explicit mention, so stored text cannot turn into an uncontrolled mass mention. Test sends call the same render/send seam as real events.

## State and events

Configuration is guild- and type-scoped. Welcome, goodbye, Join DM, and boost default off. Welcome fires only for human members after AntiRaid/AutoMod join enforcement accepts the member and pauses after 20 accepted joins in a rolling minute. Goodbye does not announce bots. Join DM attaches a recipient-bound Server Info button, admits at most 40 sends per rolling 60 seconds and 750 per rolling hour per guild, drops overflow, releases failed-send reservations, and never retries. Welcome and Join DM resets remain independent. Boost fires when `premiumSince` transitions to a new active boost. Optional deletion is bounded to 1-30 seconds or disabled.

Thread destinations require View Channel, Embed Links, Send Messages in Threads, and a sendable thread membership state. The four-destination limit is enforced transactionally across the primary and overrides. Guild removal directly purges lifecycle, level/analytics, and event-log state even if an optional service failed to initialize.

## AutoPFP terminal provider boundary

The current guide publishes `add`, `interval`, `test`, `list`, and `remove`, six named categories, Administrator authority, Manage Webhooks preflight, 2-minute through 1-day intervals, and a highest allowance of 15 channels. It does not publish or license the category image pools or name a lawful image provider/API. ByteBot therefore registers the standalone surface in its Administration category and returns an explicit provider-assets blocker without persisting a schedule or creating a webhook. It must not scrape Greed, copy private assets, substitute unrelated guild avatars, or claim image-category parity. This is a source-cited terminal provider/licensing boundary, not an implemented image feed.

Existing `guilds.welcome_*` values are copied into the new lifecycle table during migration without deleting or rewriting the legacy columns. Discord remains authoritative for its native system channel and flags.
