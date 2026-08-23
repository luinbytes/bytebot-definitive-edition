# Greed lifecycle messaging contract

Researched 2026-08-23 from the current public [Welcome](https://greed.best/docs/server-configuration/automation/welcome), [Leave](https://greed.best/docs/server-configuration/automation/leave), and [System Messages](https://greed.best/docs/configuration/messages/system) guides plus the official English registry at [`greedbest/i18n@3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/server).

## Public surface

- Welcome and goodbye expose setup, channel, message, test, view, and reset.
- Goodbye message configuration exposes optional auto-delete from 1 through 30 seconds.
- Boost exposes channel, message, variables, view/settings, and remove.
- Discord-native system messages expose channel removal/selection plus welcome, boost, and welcome-sticker toggles.
- Custom templates support variables and embedded or plain presentation. ByteBot supports the public `$v` embed directives for content, titles, descriptions, colors, URLs, images, thumbnails, timestamps, authors, fields, footers, and buttons; non-link buttons render disabled because lifecycle messages have no documented interaction action.

ByteBot presents the custom surfaces as `/server welcome`, `/server goodbye`, and `/server boost`; Discord-native settings live under `/server system`. Each custom group uses `setup`, `channel`, `message`, `enable`, `disable`, `format`, `variables`, `test`, `view`, and `reset`. The conflicting hosted boost guide and pinned registry are reconciled explicitly: boost also exposes pinned `settings` and `remove`, while retaining hosted `setup`, `test`, and `reset`.

## Variables and safety

The existing welcome variables remain compatible: `{user}`, `{mention}`, `{username}`, `{tag}`, `{displayname}`, `{server}`, `{memberCount}`, `{memberNumber}`, join/account timestamps, and account-age values. All message types also expose `{channel}`; boost adds `{boostCount}` and `{boostLevel}`. Greed-style aliases such as `{user.name}`, `{user.mention}`, `{guild.name}`, and doubled braces are normalized to the same values.

Templates are validated before storage. Unknown variables are rejected. Message sends disable broad role/everyone parsing and permit only the lifecycle member's explicit mention, so stored text cannot turn into an uncontrolled mass mention. Test sends call the same render/send seam as real events.

## State and events

Configuration is guild- and type-scoped. Welcome, goodbye, and boost default off. Welcome fires after AntiRaid/AutoMod join enforcement, goodbye on member removal, and boost when `premiumSince` transitions to a new active boost. Optional deletion is bounded to 1-30 seconds or disabled.

Existing `guilds.welcome_*` values are copied into the new lifecycle table during migration without deleting or rewriting the legacy columns. Discord remains authoritative for its native system channel and flags.
