# Greed backup, customization, and discovery compatibility contract

Issue: [#47](https://github.com/luinbytes/bytebot-definitive-edition/issues/47)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for ByteBot's backup, server customization,
server discovery, and server-stat-card work. It uses current first-party Greed
pages, the official `greedbest/docs` repository, the official English
localization registry pinned by the parity program, and Discord's API
documentation. No live Greed bot or Discord guild was queried.

## Source precedence and conflicts

| Source | Evidence used | Resolution |
| --- | --- | --- |
| [Current Greed backup guide](https://greed.best/docs/configuration/backups) | Backup contents and exclusions, create/restore syntax, merge/destructive modes, confirmation, limits, throttling, and permission caveats. | Current guide is the behavior baseline. Its account-scoped storage wording conflicts with the pinned command copy's server wording; ByteBot uses an explicit guild-plus-actor namespace because it has no Greed account service. |
| [Current Greed premium guide](https://greed.best/docs/premium) | Server-only features, Customize fields, bio limit, premium products, and current caps. | Strongest current entitlement evidence. ByteBot exposes the feature without a billing gate, as required by #33. |
| [Current Greed premium page](https://greed.best/premium) | Discovery listing banner, discovery bump cadence, and analytics retention language. | Confirms the product claims but does not establish command names, option types, listing fields, or card layout. Those remain evidence gaps. |
| [Official `greedbest/docs` customization page](https://github.com/greedbest/docs/blob/main/customization.mdx) | `customize name/avatar/banner/bio/reset`; image URL/attachment input; older 200-character bio wording. | Command names are corroborated by the pinned registry. The 200-character limit loses to the current premium page and pinned `bio` response, both of which say 190. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) | Exact command paths, descriptions, error text, customization input/limits, backup restore UI strings, and preset paths. | Registry paths are included even when the current docs omit them. Localization proves a public command surface, not Discord option types, runtime permissions, or current registration. |
| [Greed Discover page](https://greed.best/discover) | The public website browses Greed communities and published message scripts; it exposes server/script search and filtering. | This is web discovery evidence, not evidence of a Discord discovery command or a public server-directory schema. |
| [Discord Guild resource](https://docs.discord.com/developers/resources/guild) | Guild Preview fields and discoverability requirement; current-member nickname/avatar/banner/bio fields; guild and widget boundaries. | Discord-native public fields and bot-managed current-member fields define ByteBot's lawful boundary. |
| [Discord User resource](https://docs.discord.com/developers/resources/user) | Global bot user modification only covers application username/avatar/banner. | ByteBot must not describe a guild-member customization as a per-guild application identity mutation. |

The live `/commands` page is client-rendered and Cloudflare-protected during
this research. It advertises a catalog, but its public HTML does not expose a
machine-readable command registry. The pinned registry and feature-specific
first-party docs are therefore the exact source for this slice; undocumented
live behavior is not inferred.

## Public feature and entitlement matrix

| Area | Public evidence | Entitlement in Greed | Highest documented limits | ByteBot contract |
| --- | --- | --- | --- | --- |
| Backups | Snapshots restore server structure/configuration. Captured state is listed below. | Server Premium; the guide also says server administrator permissions. | Five backups per account; name 1–100 chars; description 0–500 chars; no hard size limit; restore throttled at 250 ms per role/channel. | Provide the documented backup lifecycle with versioned, validated, guild-scoped records containing only ByteBot-owned or Discord-restorable state. No purchase or premium check. |
| Bot customization | Per-server nickname, avatar, banner, bio, and rendered-card font/effect. | Customize, a one-time per-server add-on. | Bio up to 190 chars. The registry says image input is PNG/JPG/GIF/WebP up to 8 MB; nickname up to 32 chars. | Use Discord's current-member profile fields where the API supports them. Store card font/effect as ByteBot-owned rendering settings; do not claim application-level branding changes or invent Greed's unlisted font/effect values. |
| Server discovery | Greed's current premium copy names Server discovery and the premium page mentions a custom listing banner and hourly rather than two-hour bumps. The web Discover page lists communities and scripts. | Server Premium. | Bump cadence is advertised as one hour premium versus two hours, but no command, listing limit, moderation rule, or field schema is public. | Make discovery explicitly opt-in. Publish only a stable allowlisted card from intentionally public guild metadata; do not scrape or claim participation in Discord's native discovery directory. |
| Server stats card | Current premium guide names Server stats card. The premium page says free analytics retain 60 days and premium retains three years with longer ranges in the stats picker. | Server Premium. | 60 days baseline / 3 years premium for analytics retention. | Reuse ByteBot's existing `/stats server` and analytics rows. Render only metrics ByteBot actually stores and label the retention/range honestly; the Greed card's exact layout, command, and metric set are unknown. |

Former premium behavior is enabled for all ByteBot servers at the highest
documented allowance. There is no billing, voting, payment, entitlement, or
Discord monetization implementation in this slice.

## Backups: exact public surface

The pinned registry places the command in `locales/en/commands/server/backup`
and establishes the following paths:

| Public path | Evidence and options | Notes |
| --- | --- | --- |
| `backup` | Description: create/manage backups; advertised children are `create`, `list`, `view`, `delete`, `rename`, `restore`. | Server category. The registry's root error lists the same six children. |
| `backup create (name) [description]` | Current guide documents required name and optional description. Registry response usage documents `(name)` and reports backup ID and size. | Name 1–100; description 0–500. Creating at the per-account five-backup limit fails. |
| `backup list` | Registry describes listing all backups and a `count/max` footer. | Pagination is not publicly specified. |
| `backup view (backup_id)` | Registry requires a backup ID and describes detailed view. | ID format and whether the response is ephemeral are not specified. |
| `backup rename (backup_id) (new_name)` | Registry requires ID and new name. | New name follows the documented 1–100 limit. |
| `backup delete (backup_id)` | Registry requires ID. | Destructive metadata removal needs confirmation in ByteBot. |
| `backup restore (backup_id) [mode]` | Current guide documents optional `merge` (default) or `destructive` mode. Pinned restore strings add an interactive mode picker and a second selection of items to restore, followed by final confirmation. | The public sources do not define the exact Discord option shape for mode or item selection. ByteBot must preview the validated plan and require explicit confirmation before mutation. |

### Backup payload

The current guide says a snapshot captures:

- roles: name, color, permissions, icon, position, hoisted, and mentionable;
- channels: type (text, voice, category, forum, or stage), name, topic,
  permissions, slowmode, NSFW flag, and parent category;
- custom emojis and their names/restrictions;
- custom stickers; and
- channel overwrites, role/member permission references, role hierarchy order,
  and default member permissions.

It explicitly excludes message content, bot roles, webhooks, application
commands, server-native settings (including server name, region, verification,
2FA, explicit filter, notification defaults, invite splash, banner, icon,
community flag, and vanity URL), user join dates/roles/nicknames, voice/thread
activity, and pins. Cross-server role IDs do not transfer correctly. Restore
can partially apply, and the bot's role must be above roles it creates or
edits. Destructive mode removes existing roles except `@everyone` and existing
channels before recreating the selected backup structure; it does not delete
messages.

ByteBot records a schema version, source guild, creator, created/updated times,
description, and an integrity digest around this payload. A preview must show
the exact selected sections and counts before a restore. Unknown fields,
foreign IDs, messages, webhooks, application commands, and Discord-native
settings are rejected or omitted rather than copied as if restorable.

The current guide says “up to 5 backups per account,” while the registry says
“backups created for this server.” ByteBot has no Greed account backend, so the
safe compatibility decision is a unique `(guild_id, creator_id, name/id)`
namespace with a maximum of five per creator in that guild. This keeps backups
guild-local, prevents cross-server leakage, and makes restore authorization
auditable. If the product later adds an explicit account identity, this choice
must be revisited in a separate migration.

## Customization: exact public surface

The pinned registry places customization in `locales/en/commands/server/customize`.
The official docs page uses the same prefix-command names; ByteBot maps them to
the existing server intent hub:

| Public path | Exact evidence | ByteBot boundary |
| --- | --- | --- |
| `customize` | Root description “Customize bot appearance in this server”; root response includes `ownerOnly`. | Require the guild owner or the repository's equivalent owner/administrator policy. Path-aware RBAC may narrow this further, never broaden it past real Discord ability. |
| `customize name (nickname)` | Set the bot's nickname in this server; empty is rejected, max 32 chars, and no-permission/failure responses are documented. | Call the current-guild-member nickname API only. Do not edit the global application username. |
| `customize avatar (url or attachment)` | Set bot avatar in this server. Registry accepts URL/attachment and documents PNG/JPG/GIF/WebP, max 8 MB. | Fetch/validate within bounded size/type/time limits, then use a current-member guild avatar field if the installed Discord API supports it. |
| `customize banner (url or attachment)` | Same input and 8 MB/type evidence as avatar. | Use only the current-member guild banner field; do not edit the global application banner. |
| `customize bio (new bio)` | Set bot bio in this server; empty is rejected and max is 190 chars in the current registry. | Use only the guild-member bio field. Preserve Unicode character validation and reject over-limit values before calling Discord. |
| `customize reset` | Reset bot appearance to default in this server. | Clear only ByteBot's guild-member customization state and restore supported fields; do not reset unrelated server branding. |
| `customize preset apply (id/name)` | Pinned registry path; applies a bot profile preset. | Included as pinned-registry coverage, but current live premium/docs pages do not mention presets. Keep it guild-scoped and preview changes before applying. |
| `customize preset create (name)` | Pinned registry path; creates a preset from the current bot profile. Name empty/too long errors are documented; one response mentions up to 10 presets for premium servers. | Preset name maximum is 50 in the pinned response. Treat the premium-only count as a stale/uncorroborated conflict and use the highest safe ByteBot cap without billing. |
| `customize preset list` / `customize preset remove (id/name)` | Pinned registry paths and descriptions. | List/remove only presets created in the current guild. |

The current premium guide also promises “the font and effect used on rendered
cards,” but neither the current docs nor the pinned registry names a command,
option type, allowed-value list, or limit for either setting. Those fields are
therefore an explicit evidence gap: ByteBot may expose a small documented
ByteBot style enum for its own cards, but must not present it as Greed's exact
font/effect set.

### Discord customization boundary

Discord's current [Guild Member resource](https://docs.discord.com/developers/resources/guild)
defines a guild member's `nick`, `avatar`, and `banner` fields and its
**Modify Current Member** endpoint accepts `nick`, `avatar`, `banner`, and
`bio`. The same endpoint documents `CHANGE_NICKNAME` for nickname changes.
The separate [Modify Current User](https://docs.discord.com/developers/resources/user)
endpoint changes the application's global username/avatar/banner and has no
guild argument. Accordingly:

- per-guild customization is lawful only for the current bot member fields
  supported by Discord and the installed discord.js/API version;
- avatar/banner/bio changes to another member are not implied by the
  `Modify Guild Member` endpoint and are excluded;
- application/global branding, developer-portal assets, and Discord's native
  server name/icon/banner/splash are not part of `customize`; and
- every mutation needs a preflight and a clear Discord failure if the API,
  guild feature, data URI, or bot permission does not support it.

## Discovery and server cards: exact evidence and limits

The live [Discover page](https://greed.best/discover) says it browses
communities running Greed and copies message scripts used for welcomes, boosts,
and tickets. It renders a server search/filter and separate server/script
counts. The [publishing guide](https://greed.best/docs/resources/scripting/publishing)
documents published embed scripts (up to ten per owner, with an optional
description up to 200 characters) and one-click copying. ByteBot already has
an in-bot published-embed path from the rich-content slice; this issue's
server discovery is a separate, opt-in guild listing surface.

The current premium page adds two claims without a command contract: a custom
banner on a discovery listing and bumps every hour rather than every two hours.
The current premium guide names “Server discovery” and “Server stats card” but
does not name a command, argument, permission, card schema, listing limit,
moderation/review workflow, or exact bump semantics. The pinned English
registry contains no `discover`, `discovery`, `server discovery`, or
`serverstats` command path. Therefore no exact Greed slash path may be claimed.

### ByteBot slash placement

These are ByteBot mappings, not claims that Greed registers the same slash
paths. They preserve the existing `/server` intent hub and Discord's one-group
plus-one-subcommand nesting limit:

| Existing intent/category | ByteBot path | Mapping |
| --- | --- | --- |
| Server / Server | `/server backup create`, `list`, `view`, `rename`, `delete`, `restore` | Mirrors the six pinned `backup` children. IDs, names, description, mode, and section selection are typed options. |
| Server / Server | `/server customize name`, `avatar`, `banner`, `bio`, `reset` | Mirrors the five pinned profile operations. URL/attachment, nickname, and bio are typed options. |
| Server / Server | `/server customize preset` with an `action` choice (`create`, `list`, `apply`, `remove`) | Flattens the pinned `customize preset <child>` paths because Discord cannot represent a third command token. Name/id is conditional on the selected action. |
| Server / Server | `/server discovery` (ByteBot-owned opt-in/list/edit/bump actions as needed) | No Greed command is asserted. The help entry must label this as ByteBot discovery and explain that listing is opt-in. |
| Existing Server / Information | `/server stats` and the existing `/stats server` alias | Reuse the current stats handler. The pinned `guildstats` name is a compatibility alias/ledger entry, not evidence of a new premium card command. |
| Existing Utility / Server | Existing `/embed publish` and discovery/copy flow | Keep published embed discovery separate from server-directory discovery; the current Greed Discover page documents both concepts on one website. |

All new paths must be included in help and path-aware RBAC metadata. The
source-category label remains useful for reconciliation (`server`,
`information`, `utility`), while the existing ByteBot intent hub remains the
user-facing grammar.

ByteBot's safe contract is:

- discovery is a new ByteBot server/utility surface and is opt-in per guild;
- a listing contains only explicitly public fields: guild ID (or a stable
  public short ID), name, icon, description, approximate member count, public
  invite/link supplied by the owner, selected public tags, and an optional
  ByteBot-hosted banner; and
- private channels, member lists, roles, moderation/security state, message
  content, analytics detail, owner identity, and unlisted integrations never
  enter a public listing unless a future source and policy explicitly permit
  them.

Discord's [Guild Preview object](https://docs.discord.com/developers/resources/guild)
is the public-field floor: ID, name, icon, splash/discovery splash, emojis,
features, approximate member/presence counts, description, and stickers. The
Get Guild Preview endpoint requires the guild to be discoverable when the
requester is not a member. ByteBot must not confuse that API with Greed's own
directory, and must require explicit ByteBot listing consent even when Discord
metadata is public.

For stats, the pinned `information/guildstats.json` registry entry describes a
`guildstats` command showing total members, joins, and leaves. ByteBot already
has `/stats server` with live structure, command, moderation, pod, and voice
data. The current premium copy's three-year retention claim does not disclose
which historical metrics appear on the premium card. The implementation may
reuse existing analytics and render total members, joins, leaves, messages,
reactions, voice, and membership only where a real persisted row exists; it
must not fabricate history or call the existing command a Greed-compatible
premium card without recording this evidence gap.

## RBAC and Discord permission matrix

| Operation | Greed evidence | ByteBot requirement |
| --- | --- | --- |
| Backup create/list/view/rename/delete/restore | Backup guide says premium and server administrator. | Guild-only; default Manage Server/owner policy plus path-aware RBAC. Restore additionally preflights the exact roles/channels/emojis/stickers Discord permissions and hierarchy it will mutate. |
| Customize | Pinned root says owner-only; per-command responses include no-permission errors. | Guild owner/administrator policy, path-aware RBAC, and current-member API preflight. Nickname requires the real nickname permission; profile fields must be accepted by Discord for the bot's current member. |
| Discovery opt-in/edit/bump | No public command permission is documented. | Guild owner/Manage Server by ByteBot policy; publish only explicitly opted-in public data. Bump cooldown is ByteBot-owned because Greed's exact command is unknown. |
| Stats view | Read-only public/current guild data. | No elevated permission for viewing; analytics retention and detail remain guild-scoped and bounded. |

ByteBot RBAC cannot grant a real Discord permission. Every mutating path must
check the bot's actual channel/guild permissions and role hierarchy immediately
before mutation, and every response must identify an unsupported API or denied
permission rather than claiming success.

## Unknowns, exclusions, and delivery blockers

- Greed's exact Discord registration (slash versus prefix), option types,
  aliases, command IDs, and command-category metadata for this slice are not
  publicly exported. Pinned paths are evidence of names, not a registration
  guarantee.
- The current backup guide and pinned registry disagree on account versus
  server storage, and the registry's restore strings imply item-selection UI
  absent from the guide syntax. ByteBot's guild-plus-actor namespace and
  previewed section selection are explicit compatibility decisions, not Greed
  runtime facts.
- Discovery has no public command path, listing schema, owner/moderation
  workflow, invite requirements, listing cap, or exact bump command. Do not
  invent a Greed command or claim native Discord discoverability.
- Server-stats-card metric names, chart layout, date-picker choices, slash path,
  and permission contract are not public. Three-year retention is the only
  current premium limit evidenced.
- Card font/effect names and limits are not public. No exact Greed font/effect
  parity claim is allowed until a first-party source defines them.
- Older `docs.greed.best` pages and the older `customization.mdx` bio limit of
  200 are retained only as conflicts. Current `greed.best` pages and the
  pinned 190-character registry response win.
- Discord-native server settings, global application branding, arbitrary
  member profile edits, private guild data, message backups, webhook tokens,
  and undocumented Greed dashboard/business/billing behavior are excluded.
- No live Greed bot probing, production guild mutation, or repository test
  suite run is part of this research gate.

## Verification gate for implementation

Before feature work is considered complete, the slice must leave checks for:

- generated slash JSON, hub/help discovery, path-aware RBAC, and Discord option
  limits;
- backup schema versioning, digest validation, guild/actor isolation,
  malformed/unknown payload rejection, preview accuracy, merge/destructive
  confirmation, partial-failure reporting, and bot permission/hierarchy
  preflights;
- customization URL/attachment size/type validation, 32/190 limits, owner
  boundary, current-member API payloads, reset/preset scope, and global-branding
  refusal;
- discovery opt-in, public-field allowlisting, invite/link validation,
  listing ownership, bump cooldown, and removal when consent is withdrawn; and
- stats-card range/retention bounds, real-row-only metrics, guild isolation,
  and honest unavailable-history responses.

Focused checks should run only after this contract is accepted and the relevant
implementation exists. No live Greed access or production Discord token is
needed to test these seams.
