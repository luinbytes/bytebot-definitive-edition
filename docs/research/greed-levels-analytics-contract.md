# Greed levels and bounded analytics compatibility contract

Issue: [#50](https://github.com/luinbytes/bytebot-definitive-edition/issues/50)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for Greed's Levels, server analytics, and
logging families. It records the current public evidence first and then the
small set of explicitly ByteBot-owned decisions needed to make the feature
safe and implementable. No live Greed bot or Discord guild was queried. No
Greed runtime behavior is inferred from a screenshot, a localization filename,
or an absent command row.

## Source precedence and conflicts

| Source | Evidence used | Resolution |
| --- | --- | --- |
| [Current Levels guide](https://greed.best/docs/configuration/levels) and its [official source](https://raw.githubusercontent.com/greedbest/docs/main/configuration/levels.mdx) | Public prefix-command syntax, member/admin split, text/voice XP claims, setup controls, anti-spam, voice eligibility, aliases, reset warning. | The raw first-party source is the reproducible text baseline; the hosted page confirms the same rendered content. It does not establish XP rates, formulas, cooldowns, role caps, or exact Discord permissions. |
| [Current Logging guide](https://greed.best/docs/configuration/logging) and [official source](https://raw.githubusercontent.com/greedbest/docs/main/configuration/logging.mdx) | Log setup/removal/view syntax, module names, moderation-log setting, and module descriptions. | The raw source is the reproducible baseline. The hosted page is newer in presentation and uses singular event names plus an interactive no-argument form; those are retained as compatibility aliases, not silently merged into a single Greed fact. |
| [Current Greed homepage](https://greed.best/) | Greed says it tracks “messages, reactions, voice, and membership over time” and renders cards/charts. | This establishes product-level analytics categories only. It does not establish a command, option names, chart grain, membership definitions, or historical backfill behavior. |
| [Current Premium guide](https://greed.best/docs/premium) | Analytics retention is 60 days free / 3 years Server Premium; “Server stats card” is named as Premium-only; free/premium log-channel caps are 4/15. | These are the current numeric entitlement facts. ByteBot has no billing service, so it provides the highest documented non-billing allowance (15 log channels and 1,095 days) and labels that as a ByteBot policy. |
| [Current command catalog](https://greed.best/commands) | The catalog claims to list every command with arguments and permissions. | The page is client-rendered; its public HTML exposes the claim and controls but not the Levels, analytics, or Logs rows. It cannot prove exact registration, option types, permissions, or Premium flags. |
| [Pinned official English i18n tree](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) at [commit `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/commit/3dadc41852a09567add8a6b2b522d5e2b1a53b2f) | Exact public names, descriptions, response copy, errors, setup labels, limits explicitly present in English JSON. | This is the exact localization baseline for the pinned snapshot. A localized path proves a public subject/message surface, not that it is currently registered or that the JSON contains its option schema/permission. |
| ByteBot's existing [stats handler](../../src/commands/utility/stats.js), [`/server` hub](../../src/commands/administration/server.js), [activity schema](../../src/database/schema.js), and event handlers | The internal `stats` handler powers the registered `/server stats` path with a 1-1,095 day range (default 60), daily message/reaction/voice/command rows, member-level rows, and current event filters. | Existing behavior is preserved. New work must use one shared `LevelAnalyticsService` seam and must not claim historical membership or general-voice coverage that ByteBot has not persisted. The internal `stats` handler remains `register: false`; no duplicate `/stats` root is introduced. |

The pinned tree has both a legacy-looking `locales/en/commands/levels` tree
and the more explicit `locales/en/commands/server/levels` tree. The former
contains detailed handler copy; the latter contains current public path names.
Both are first-party evidence, but neither alone proves a Discord command
registration. The contract reports the conflict instead of counting duplicate
files as duplicate commands.

## Public Levels surface

### Current guide syntax

The current guide describes a dual-track system with text and voice XP, an
interactive setup menu, member views, leaderboards, role rewards, and
administrative management. These are exact public prefix strings; the square
and round brackets below are the guide's notation, not Discord option schemas.

| Public string | Public behavior and exact options | Public limits/permissions evidenced |
| --- | --- | --- |
| `,levels setup` | Opens interactive setup. It can independently toggle Text and Voice XP, choose an Award Channel, customize an Award Message, and manage Level Roles. | No numeric limits. Pinned setup copy explicitly says `You need **Manage Server** permission`; the guide itself does not state a permission. |
| `,level [@user]` | Shows current level, total XP, and progress to the next level with a custom rank card. | Optional member. Aliases are `,rank`, `,xp`, `,lvl`. |
| `,levels leaderboard [total/text/voice]` | Shows top members sorted by total, text, or voice XP. | Choice set is exactly `total`, `text`, `voice`; page size, maximum page, tie-break, and permission are not public. Aliases: `,levels lb`, `,levels top`. |
| `,levels roles` | Lists roles configured as rewards for reaching levels. | No list cap or permission is public. |
| `,levels live text` | Creates a self-updating text-XP leaderboard in the current channel. | The guide does not state update interval or permission; pinned i18n describes automatic updates every 5 minutes. |
| `,levels live voice` | Creates a self-updating voice-XP leaderboard in the current channel. | Voice variant; the same interval/permission gap applies. |
| `,levels boost add (role/channel) (multiplier)` | Gives a role or channel an XP multiplier. | Target is a role or channel; multiplier bounds are not in the guide, but pinned handler copy says 0–10. |
| `,levels award (user) (amount)` | Gives or takes XP from a member (the guide says “give or take”). | Member and amount are required in the public syntax; sign semantics and bounds are not in the guide. |
| `,levels reset user @user` | Wipes one member's leveling data. | Destructive; no permission/confirmation syntax is public. |
| `,levels reset all` | Wipes all server leveling data. | The guide says it is permanent and cannot be undone. |
| `,levels ignore #channel` | Prevents XP gain in a channel, including examples such as bot-command/staff channels. | Channel required in guide syntax; role-ignore is present in pinned handler copy but not the guide. |

The guide says text XP is earned by sending messages and includes anti-spam
protection. It says voice XP is earned by staying in voice channels and
requires the member to be unmuted and not alone in a channel. It gives no
formula, amount, cooldown, session cap, XP carry/rounding rule, or definition
of “alone.” Those are ByteBot-owned rules below.

### Pinned English localization

The pinned [legacy Levels files](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels)
include [`admin.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels/admin.json),
[`manage.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels/manage.json),
and [`setup.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels/setup.json).
The current path-oriented files are under the pinned [`server/levels` tree](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/server/levels):

| Pinned path/name | Exact public description or response evidence |
| --- | --- |
| `levels` | “Configure and manage the leveling system.” Advertised children: `setup, leaderboard, stats, roles, live, reset all, reset user, setrate, add, remove, sync, message, ignore, config, stackroles`. |
| `levels setup` | “Configure the leveling system with an interactive setup”; error `Level service is unavailable`. The setup UI says “Text and voice XP can be configured independently,” “Changes save automatically,” and offers Text: ON/OFF, Voice: ON/OFF, Level Roles, More Settings, Reset All XP, confirmation, Cancel, Back. |
| `levels stats` | “View your or another user's level stats”; title `{{username}}'s Level Stats`; fields `Total XP: {{xp}}`, `Text Stats`, `XP: \`{{xp}}\`\nMessages: \`{{messages}}\``, `Voice Stats`, `XP: \`{{xp}}\`\nTime Spent: \`{{time}}\``, `Progress to Level {{level}}`, and `{{bar}}\n{{current}} / {{required}} XP`. Missing users return `Could not find that user`; service failure returns `Level service is unavailable`. |
| `levels leaderboard` | “View the XP leaderboard for this server”; empty state `No one has earned any XP yet`; service failure `Level service is unavailable`. |
| `levels roles` | “View the configured level role rewards”; empty state `No level role rewards have been configured`; service failure `Level service is unavailable`. |
| `levels live`, `levels live text`, `levels live voice` | Root description “Set up a live-updating leaderboard”; usage `Usage: **levels live (text\|voice)** — Set up a live-updating leaderboard in this channel`; text/voice descriptions explicitly say “in this channel.” The legacy `levels/live/index.json` says it updates automatically every 5 minutes. |
| `level add` / `level remove` | Add/remove a role reward for a specific level. No option schema or success copy is present. |
| `level setrate` | “Set the XP gain multiplier for this server.” Pinned manage errors say `Multiplier must be between 0 and 10.` |
| `level setlevel` / `level setxp` / `level removexp` | Set a user's level, set total XP, or remove XP. Exact admin errors: `Amount must be zero or greater.`, `Amount must be greater than zero.`, `Level must be between 1 and 999.` Exact successes include `Set total XP for {{mention}} to **{{total}}**.`, `Removed **{{amount}}** XP from {{mention}}. New total XP: **{{total}}**.`, and `Set level for {{mention}} to **{{level}}**.` |
| `level sync` | “Sync level roles for all members based on their current level”; success `Synced level roles for **{{count}}** members.` |
| `level message` / `level message view` | Set/view the custom level-up message. Setup modal title is `Custom Level Up Message`; label `Message`; placeholder `{user} = mention, {level} = level number`. Exact info strings are `This server is using the **default** level up message.`, `Level up messages are currently **disabled** for this server.`, and `Current level up message:\n>>> {{message}}`. Manage errors cap a custom message at 2,000 characters. |
| `level ignore` | “Ignore channels or roles from earning XP.” Exact successes distinguish `{{channel}} is now ignored for XP.`, `{{channel}} is no longer ignored for XP.`, `{{mention}} is now ignored for XP.`, and `{{mention}} is no longer ignored for XP.` The list is `**Ignored channels for XP:** {{channels}}\n**Ignored roles for XP:** {{roles}}`, with `*None*` for an empty side. |
| `level stackroles` | “Enable or disable stacking of level roles (members get all roles up to their level).” Exact option error: `Invalid option. Use \`on\` or \`off\`.`; info/success copy says stacking is `enabled` or `disabled`. |
| `levels reset all` / `levels reset user` | Reset all XP returns `All XP has been reset for this server`; user reset returns `XP has been reset for {{user}}`. The setup warning is `**WARNING:** This will delete **ALL** text and voice XP data for this server. This action **cannot be undone**.\n\nAre you sure you want to continue?`; the UI confirmation is `Yes, Reset All XP`. User errors include `Please specify a user to reset`, `Invalid user provided`, and `Could not find that user in this server`. |

The same pinned handler files also contain these exact management strings:
`XP gain multiplier has been set to **{{multiplier}}x**.`;
`Please provide both a role and a level.`; `Please provide a level to remove.`;
`No level roles are configured for this server.`; `Added {{mention}} as reward
for level **{{rank}}**.`; `Removed level role configuration for level
**{{rank}}**.`; `Message must be 2000 characters or less.`;
`Please provide a message.`; `Custom level up message has been set.`;
`Synced level roles for **{{count}}** members.`; `Stacking of level roles has
been **{{state}}**.`; `Stacking of level roles is currently **{{state}}**.`;
`{{mention}} is now ignored for XP.`; `{{mention}} is no longer ignored for
XP.`; `{{channel}} is now ignored for XP.`; and `{{channel}} is no longer
ignored for XP.`. These strings are from the pinned
[`levels/manage.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels/manage.json)
and [`levels/setup.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/levels/setup.json)
files; they are not claims that every string has a currently registered
command path.

The pinned setup copy also exposes settings labels `XP per Minute`, `Max XP per
Session`, `Min Voice Time`, `Excluded Channels`, and `Excluded Roles`; it does
not provide their values. The pinned registry has no public option-type JSON,
default XP rate, default session cap, or role-count cap.

### Public evidence gaps for Levels

The following cannot honestly be called Greed behavior from current first-party
sources: XP-per-message amount; message cooldown and anti-spam algorithm;
level-to-XP formula; text/voice enable defaults; voice XP per minute, minimum
time, and maximum session XP; treatment of bots, commands, edits, deletions,
muted/deafened/self-deafened members, stage channels, and screenshare; boost
combination order and default; role reward count/stacking defaults; live
leaderboard message count, update interval beyond the pinned “every 5 minutes,”
recovery after deletion, and creator permission; page size/tie-breaks;
`award` sign semantics; exact slash/prefix registration; and all admin
permissions except the pinned setup `Manage Server` string.

## Public logging surface

The official raw logging source documents these modules: `messages` (message
edits/deletions), `members` (joins/leaves/profile updates), `moderation`,
`server`, `voice`, `channels`, `roles`, `invites`, `emojis`, `stickers`,
`integrations`, and `soundboard`. The hosted page currently renders the first
ten with singular aliases (`message`, `member`, `channel`, `role`, `invite`,
`emoji`, `sticker`, `integration`) and does not show `soundboard`; it also says
that no-argument `,logs add` opens an interactive selector. ByteBot accepts both
spellings and retains all twelve raw modules, while exposing a fixed bounded
channel cap below.

| Public string | Exact public behavior/options | Exact pinned response/error evidence |
| --- | --- | --- |
| `,logs add (channel) (module)`; hosted form `,logs add [channel] [events]` | Add a channel for one or more log modules. Raw example: `,logs add #message-logs messages`. Hosted docs say no arguments opens an interactive event selector; the raw source allows multiple categories in one channel by repeating the command. | Pinned [`logs/add.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs/add.json): `Added events **{{events}}** to {{channel}}`; moved events copy; channel-required, channel-not-found, database-unavailable, invalid-event, add-failed, button-not-for-you errors. Its premium error says `Maximum log channel limit reached ({{max}} for {{premium}} servers). Upgrade to Premium for unlimited log channels.` This conflicts with the current Premium guide's numeric 4/15 caps; current numeric guide wins. |
| `,logs view` | View configured logging channels and associated event types. | [`logs/view.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs/view.json): title `Logging Channels`; empty `No logging channels are configured. Use \`logs add #channel\` to add one.`; footer `{{count}} logging entries`; database-unavailable error. |
| `,logs remove [channel] [module]` | Remove a specific module from a channel or, with no channel/module, remove all logging events. Raw example: `,logs remove #message-logs message`. | [`logs/remove.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs/remove.json): `All logging channels have been removed.`, `Removed events **{{events}}** from {{channel}}`, `Logging channel {{channel}} has been removed.`, plus channel-not-found, database-unavailable, invalid-event, remove-failed, and no-log-channel-configured errors. |
| `logs color` | Pinned [`logs/color.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs/color.json) describes customizing an embed color for a log event; success is `Set the color for **{{event}}** logs in {{channel}} to \`#{{hex}}\`.`; invalid color says `Invalid color. Use a hex value like \`#ff0000\`.`. | Exact option order/type is not in the JSON. ByteBot uses channel + event + six-digit hex. |
| `logs ignore` | Pinned [`logs/ignore.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs/ignore.json) ignores a member or channel. It requires a member/channel target and has an ignored-target list with `{{count}} ignored entries`. | Exact errors: `Please mention a member or channel to ignore.` and `That is not a valid member or channel in this server.`; success `Now ignoring logs for {{target}}.` |
| `,settings modlog [channel]` | Sets a dedicated moderation case-log channel distinct from general `moderation` events. Aliases: `,settings moderationlogs`, `,settings modlogs`. Raw docs say default `#logs` is created by `,setup`. | [`settings/modlog.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/settings/modlog.json): success `Moderation log channel has been set to {{channel}}`; missing/invalid channel, database unavailable, and set-failed errors. |

The pinned logging error copy is also exact: `Please specify a channel. Use
\`logs add #channel [event]\`.`; `Maximum log channel limit reached ({{max}}
for {{premium}} servers). Upgrade to Premium for unlimited log channels.`;
`Channel not found. Please mention a channel or provide a valid channel ID.`;
`Database service is unavailable. Please try again later.`; `Invalid event type.
Available events: {{events}}`; `Failed to add the log channel. Please try
again.`; `This button is not for you.`; `Invalid color. Use a hex value like
\`#ff0000\`.`; `No logging is configured for {{channel}}. Use \`logs add\`
first.`; `Please mention a member or channel to ignore.`; `That is not a valid
member or channel in this server.`; `There are no ignored members or channels
configured.`; `Channel not found. Please mention a channel or provide a valid
channel ID.`; `Failed to remove the log channel. Please try again.`; and `No
log channel is configured for this channel.`. These values come from the
pinned [`logs` registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/logs);
the duplicate channel-not-found string is intentionally retained as a source
fact rather than normalized into a different response.

The logging docs do not expose exact Discord option types, whether a module
can be attached to more than one channel simultaneously, per-event payload
fields, retention, edit/delete content limits, audit-log correlation rules,
or permissions. The pinned `add` success says events can be moved from a prior
channel; ByteBot therefore treats a `(guild,module)` mapping as unique unless a
future first-party source proves multi-channel fan-out.

## Analytics evidence and current ByteBot state

### What Greed publicly claims

The homepage's exact marketing statement is that Greed “tracks messages,
reactions, voice, and membership over time” and renders cards/charts. The
current Premium guide gives only two analytics numbers: 60 days of retention
for free servers and 3 years for Server Premium; it names “Server stats card”
as a Server Premium-only feature. Neither source identifies a public analytics
command, subcommand, option, default range, chart period, user/member drilldown,
join/leave definition, message/reaction semantics, voice eligibility, or
response copy. The pinned English registry contains no `analytics` file and no
unambiguous stats-card command path. The current command catalog's rendered
rows are unavailable to a non-interactive fetch. These are evidence gaps, not
permission to invent a Greed command.

### Existing ByteBot evidence

ByteBot's internal [`stats server`](../../src/commands/utility/stats.js) handler
is loaded with `register: false` and is invoked by the registered
[`/server stats`](../../src/commands/administration/server.js) path. The
registered path accepts `days` from 1 through 1,095, defaults to 60, and
accepts an optional `private` Boolean. The handler renders current guild
structure plus real stored range sums for messages, reactions, voice minutes,
and commands. It labels a range when stored activity starts after the
requested window and does not fabricate history. The existing table is
[`activity_logs`](../../src/database/schema.js): one row per `(guild,user,date)`
with `message_count`, `voice_minutes`, `commands_run`, `reactions_given`,
`channels_joined`, `bytepods_created`, unique commands, active hours, and
first/last activity timestamps.

Current event behavior is narrower than Greed's marketing claim:

| Metric | Current event source | Current limitation |
| --- | --- | --- |
| Messages | [`messageCreate`](../../src/events/messageCreate.js) records one message for non-bot guild messages through `activityStreakService`. | No durable event ID/dedupe key; no historical backfill; ignored/automod/honeypot early-return semantics are not a documented Greed analytics contract. |
| Reactions | [`messageReactionAdd`](../../src/events/messageReactionAdd.js) records one reaction for non-bot guild users. | Remove events are not decremented; the number is reactions given, not current reaction cardinality. No durable reaction event key. |
| Voice | [`voiceStateUpdate`](../../src/events/voiceStateUpdate.js) and `bytepod_voice_stats` aggregate sessions; general voice joins are counted for streak activity but session minutes are only finalized for BytePod sessions. | This is not complete guild voice analytics. Partial/restart/move races need one shared reconciliation service. |
| Membership | [`guildMemberAdd`](../../src/events/guildMemberAdd.js), [`guildMemberRemove`](../../src/events/guildMemberRemove.js), and update handlers run lifecycle/role automation. | No daily join/leave counters, historical member snapshots, or membership-retention table exist. Current member count is live Discord state only. |
| Levels | [`member_levels`](../../src/database/schema.js) already stores `(guild,user,xp,level)` and giveaway eligibility reads it. | It is not fed by message/voice XP today; no level configuration/role-reward/live-message tables exist. |

## ByteBot slash layout and category placement

These are ByteBot mappings, not claims that Greed registers equivalent slash
paths. Greed's prefix aliases are retained in help, but Discord slash commands
have no alias field. The root is intentionally visible rather than hidden
behind a generic server/settings menu.

The `/levels` root has no default member-permission gate so member read paths
remain discoverable. Every mutating group and subcommand performs the
Manage Server/Manage Roles checks at execution time; Discord registration
metadata cannot replace those path-specific checks.

### Levels (`/levels`, Utility implementation category; Greed source category Levels)

| Slash path | Options | Access |
| --- | --- | --- |
| `/levels rank` | optional `member`, optional `private` | Any guild member; read-only. This is the slash presentation of Greed's `,level` plus `,rank`, `,xp`, and `,lvl` aliases. The pinned `levels stats` localization is the response source. |
| `/levels leaderboard` | optional `metric` choice `total`, `text`, `voice`; optional `page`; optional `private` | Any guild member; read-only. |
| `/levels roles` | optional `page`; optional `private` | Any guild member; read-only. |
| `/levels live text|voice` | Subcommands `text` and `voice`; optional `channel` (defaults current) | Manage Server plus bot Send Messages, Embed Links, and message edit/delete in the target channel. |
| `/levels boost add|remove|list` | `add` takes a role/channel target and multiplier; `remove` takes the target; `list` has no required option | Manage Server. Merely referencing a role as an XP condition does not mutate it, so no caller/bot Manage Roles check is invented. `add` multiplier is 0–10 from pinned validation; remove/list are ByteBot-owned completion paths because only `add` is publicly documented. |
| `/levels admin award|removexp|setxp|setlevel` | `award`/`removexp` take `member` and amount; `setxp` takes `member` and total XP; `setlevel` takes `member` and level | Manage Server; amount is non-negative for set, positive for removal; level is 1–999 from pinned validation. |
| `/levels reward add|remove|sync|stack` | `add`/`remove` take role + level; `sync` has no required option; `stack` takes `on`/`off` | Manage Server; all role actions additionally require Manage Roles/hierarchy. `stack` exact values are pinned; reward grouping is a Discord-compatible mapping. |
| `/levels ignore channel|role|list` | `channel` or `role` target; `list` no option | Manage Server. Role-ignore/list are pinned handler surfaces; group shape is ByteBot-owned. |
| `/levels message set|view` | `set` takes message (max 2,000); `view` no option | Manage Server; only `{user}` and `{level}` variables are accepted. |
| `/levels reset user|all` | `user` takes `member`; `all` takes a one-time confirmation | Manage Server; reset-all requires explicit confirmation and deletes all text/voice XP, matching the pinned warning. |
| `/levels setup` | Interactive setup action; all settings are component/modal-driven | Manage Server; role reward changes additionally require Manage Roles and hierarchy preflight. |

This grouping keeps all pinned subjects within Discord's one-root/one-group/
one-subcommand nesting limit and stays below 25 root options. Help displays
Greed aliases `level`, `rank`, `xp`, `lvl`, `levels lb`, and `levels top` as
text compatibility names; it does not register duplicate slash commands.

### Analytics (`/server stats`, existing Server presentation category)

Keep `/server stats` as the one registered server view, backed by the existing
unregistered Utility handler, with the existing `days` (1-1,095, default 60)
and `private` options. Use component
pages/charts inside that response for metric drilldowns rather than adding a
second `/analytics` root. Greed's `analytics` marketing term is a help/ledger
mapping only; no Greed command is asserted.

| Slash path | Options | Contract |
| --- | --- | --- |
| `/server stats` | optional `days`, optional `private`, optional `metric` choice `all/messages/reactions/voice/membership` | Sum only persisted daily rows. `membership` must say unavailable until daily join/leave/snapshot rows exist. Metric pages/charts are components on this response. |

No `/analytics` Greed-compatible path is claimed until a first-party source
names it. The help/category ledger may label these rows `Analytics` while the
implementation remains under the existing Utility `/stats` command.

### Logging (`/server logs`, existing Administration/Server hub)

Extend the existing `/server logs set` group rather than adding an unbounded
top-level root:

| Slash path | Options | Mapping |
| --- | --- | --- |
| `/server logs add` | optional `channel`; optional `module` choice from 12 canonical modules | With both values, add directly. With neither, open an actor-bound channel/module selector matching the hosted no-argument form. Supplying only one returns a validation prompt. Singular hosted aliases normalize to canonical plural names. |
| `/server logs view` | optional `private` | `,logs view`. |
| `/server logs remove` | optional `channel`; optional `module` | `,logs remove [channel] [module]`; no options removes all only after confirmation. |
| `/server logs color` | required `channel`, `module`, six-digit `hex` | Pinned `logs color`; validate `#RRGGBB` before write. |
| `/server logs ignore` | required `target` (member or channel) | Pinned `logs ignore`; include list/view in the same response. |
| `/server logs modlog` | optional `channel` | Existing `/config logs` compatibility plus Greed `,settings modlog [channel]` copy. |

All log configuration paths require Manage Server and a bot channel preflight;
read-only view is visible to members but redacts inaccessible channel names.
The existing `/config logs` path remains supported as the moderation-case-log
alias and is not removed.

## RBAC and Discord/API boundary

Greed's public docs only explicitly expose Manage Server in Levels setup and do
not publish a complete permission matrix. ByteBot therefore uses path-specific
real Discord permission checks:

| Operation | Caller | Bot preflight |
| --- | --- | --- |
| Level stats, leaderboard, roles, member analytics, server analytics | Guild member | View Channel, Send Messages, Embed Links in the response channel. |
| Level live board | Manage Server | Send Messages, Embed Links, and edit/delete the bot's own message in the target channel. |
| Level setup/config/admin | Manage Server; role mutations also Manage Roles | Role hierarchy and Manage Roles for every reward/sync operation; no operation may grant a role above the bot. |
| Reset all XP | Manage Server plus one-time actor/guild/action confirmation | Database transaction first; no Discord mutation until commit. |
| Add/remove/color/ignore log configuration and modlog | Manage Server | View Channel, Send Messages, Embed Links; View Audit Log is required only for event types that depend on audit entries. |
| Log event delivery | Not caller-triggered | Ignore bot-authored events, prevent loops, and redact content when the bot cannot fetch the source message. |

ByteBot's persistent command RBAC may narrow these checks; it must never grant
a permission absent from the member or bot's real Discord permission set. Every
component/modal interaction revalidates guild, actor, path, and target before
mutating.

## Persistence, transactions, and idempotency

Implement one deep module, `LevelAnalyticsService`, with the narrow event
interface `recordMessage(message)`, `recordReactionChange(reaction, user,
present)`, `reconcileVoiceState(oldState, newState)`,
`recordMembership(member, present)`, and `snapshotGuild(guild)`, plus command
and component handling. A separate `EventLoggingService` owns general log
configuration, delivery, and its command/components; logging must not enlarge
the leveling interface. Event handlers remain thin adapters. Reuse
`member_levels` and `activity_logs`; do not create a second XP or analytics
source of truth. The adapters replace the existing direct message/reaction/
voice counter calls; after an activity transaction commits they call the
existing streak update seam without incrementing `activity_logs` a second time.

The minimum schema additions are:

- guild-scoped level config: enabled text/voice flags, award channel/message,
  text cooldown, voice rate/minimum/session cap, base multiplier, stacking;
- additive columns on canonical `member_levels` for text XP, voice XP, signed
  manual adjustment, message count, voice seconds, and cooldown timestamps;
- guild-scoped level role rewards keyed by `(guild_id, level)` plus ignored
  channels/roles;
- persisted live leaderboard messages keyed by `(guild_id, channel_id, metric)`
  with bot message ID and last-rendered revision;
- daily server metrics keyed by `(guild_id, activity_date)` with message,
  reaction, voice-minute, join, leave, and member-count-snapshot fields; and
- a bounded idempotency ledger for events with stable Discord IDs, plus
  reaction-placement, active-voice-session, and member-presence state tables
  whose unique keys make state transitions idempotent.

Each accepted message event transaction inserts its stable message ID, updates
the daily rows, and updates `member_levels` when XP is earned. Reaction adds
and removes transition one `(guild,message,user,emoji)` placement row, so a
duplicate add is ignored while a real remove then re-add counts again. Voice
accounting settles persisted eligible intervals before changing session state;
replaying the same voice state cannot accrue the interval twice. Membership
join/leave counters change only when the persisted presence state changes.
A failed external Discord send never rolls back committed analytics; live-board
rendering and role reconciliation are idempotent retry jobs that recheck the
current bot permissions and role hierarchy on every attempt.

Membership rows are snapshots of observed events, not a claim that Discord can
provide historical joins. On first enable, the service records the current
member count as a baseline and reports “history unavailable before
<baseline-date>.” It never backfills joins/leaves from current member lists.

Analytics retention is bounded by age to 1,095 days (three years), not to
1,095 physical rows: per-user `activity_logs` may contain many rows for the
same guild/date. A scheduled prune deletes daily analytics and expired dedupe
rows older than the bound in small batches; pruning is
audited and never deletes level balances, role configuration, or immutable
security logs. Query ranges are clamped to 1-1,095 days, with a default of 60.
There is no hidden “unlimited” storage mode.

Logging configuration writes are transactional. A guild/module mapping is
unique; adding the same mapping is idempotent, moving it updates one row, and
removing an absent mapping is a no-op with the documented empty-state copy.
Log delivery uses a bounded outbox retry (three attempts, exponential delays)
and stores a dedupe key so reconnects cannot duplicate the same event. Source
content is truncated to Discord's message/embed limits and never used as a
query or executable script.

## ByteBot-owned deterministic rules

The following values are implementation choices, not public Greed facts. They
are intentionally simple, fixed, and versioned so later first-party evidence
can change them through a migration rather than silently changing balances.

| Rule | ByteBot value |
| --- | --- |
| Level cap | 999, matching the pinned public validation string. |
| XP formula | Level `n` requires `100 × n²` total XP; level is `min(999, floor(sqrt(totalXP / 100)))`. XP is integer and never negative. |
| Text XP | 20 XP per eligible message; one award per user/guild every 60 seconds. The event still counts in analytics when it is ineligible for XP. |
| Text anti-abuse | Bots, DMs, webhooks, and empty content earn no XP and no analytics count. Configured level channel/role exclusions block XP only; an otherwise accepted human guild message still counts in analytics. A user is capped at 20,000 text XP/day; rejected XP is not queued or retroactively awarded. |
| Voice XP | 5 XP per complete eligible minute, with sub-minute remainder carried in the active session. Eligibility requires a non-bot member, unmuted/non-deafened state, and at least one other non-bot member in the same voice channel. |
| Voice bounds | Minimum eligible session 60 seconds; maximum award 3,600 XP per session; sessions split at UTC midnight and channel moves. Analytics records real seconds; XP rounds only at minute boundaries. |
| Multipliers | Default server rate is 1.0x. Role and channel multipliers are each in `[0,10]`; the effective rate is the server rate times the highest applicable role/channel multiplier, clamped to 10.0x. Level-role stacking does not change XP multiplier math. XP is rounded down after multiplication. |
| Manual XP | `text_xp` and `voice_xp` remain activity tracks. A signed `manual_adjustment` records admin changes; cached canonical `xp` is `max(0, text_xp + voice_xp + manual_adjustment)`. `award` adds a positive adjustment, `removexp` subtracts without taking total below zero, and `setxp`/`setlevel` replace the adjustment so the requested total/threshold is exact. Track leaderboards therefore remain truthful after admin changes. |
| Level roles | At most 50 reward rows per guild; one role per level. Stacking defaults off: reconciliation keeps only the highest configured reward at or below the member's level. With stacking on it keeps every configured reward at or below the level. XP commits enqueue reconciliation; reads never mutate roles. Resets commit level state first, then the retryable reconciler removes obsolete configured rewards. |
| Level-up message | Default `Congratulations {user}, you reached level {level}!`; custom message max 2,000 Unicode characters; only `{user}` and `{level}` variables are substituted. Disabled means no announcement. |
| Live board | One board per `(guild, channel, metric)`, 10 entries per page, page 1 default, max 100 pages/1,000 rows, update every 5 minutes. Ties sort by total XP descending then user ID ascending. A missing/deleted message is recreated while the configuration remains active and the bot still has target-channel permissions; the original administrator need not remain in the guild. |
| Analytics | Daily UTC buckets. `messages` counts accepted non-bot guild message-create events; `reactions` counts add events; `voice` counts observed eligible voice seconds converted to minutes for display; `membership` counts join/leave events plus the latest daily member snapshot. Missing history is rendered as unavailable, never zero-filled as historical fact. |
| Analytics ranges | Default 60 days; minimum 1; maximum and retention 1,095 days. A request outside the bound returns a validation error before querying. |
| Logging modules | Canonical plural set is `messages`, `members`, `moderation`, `server`, `voice`, `channels`, `roles`, `invites`, `emojis`, `stickers`, `integrations`, `soundboard`; singular hosted names are aliases. Maximum configured channels is 15, matching current Server Premium. |
| Logging colors/ignores | Color is `#RRGGBB`; default embed color is ByteBot brand purple. Ignore entries are guild-scoped member/channel IDs; duplicate adds are no-ops. |
| Destructive confirmation | Reset-all XP and remove-all logs require a one-time confirmation bound to guild, actor, action, and exact plan, expiring after 10 minutes. |

If later Greed documentation supplies a conflicting value, the migration must
record the old and new rule versions and never reinterpret existing XP or
analytics rows in place.

## Evidence gaps and exclusions

- No public Greed analytics command, slash schema, response copy, chart/card
  layout, metric grain, user drilldown, default range, join/leave definition,
  or analytics permission was found in current docs, the client-rendered
  catalog, or the pinned English registry.
- Greed's homepage says membership is tracked but does not say whether that
  means joins, leaves, net membership, snapshots, retention cohorts, boosts,
  or member profile changes. ByteBot must expose only its persisted definitions.
- Greed's public analytics retention does not specify whether all four metric
  families retain for the same duration, whether deleted guilds are purged,
  or whether Premium changes sampling/granularity. ByteBot uses one bounded
  three-year daily policy and labels it ByteBot-owned.
- XP formulas, amounts, cooldowns, voice session behavior, leaderboard pages,
  role caps, and all Level permissions beyond the pinned setup Manage Server
  copy are undocumented. The deterministic table above is not parity evidence.
- Current hosted logging and raw source disagree on singular/plural module
  names, interactive no-argument setup, and `soundboard`; ByteBot accepts the
  union with canonical plural persistence. The pinned add error says Premium
  log channels are unlimited, while current Premium says 4/15; current
  Premium's numeric cap wins.
- Exact Discord registration (prefix versus slash), option types, aliases,
  command IDs, and premium flags remain unverified. Localization paths are
  not a machine-readable command registry.
- Existing ByteBot activity rows have no event idempotency ledger or retention
  cleanup, and general voice/membership analytics are incomplete. This is an
  implementation gap, not permission to report fabricated history.
- No live Greed bot probing, production Discord mutation, or repository test
  suite run is part of this research gate.

## Verification and acceptance matrix

Implementation is not complete until focused tests and review cover:

| Area | Acceptance evidence |
| --- | --- |
| Command contract | Generated slash JSON includes visible `/levels`, `/server stats`, and `/server logs` paths; the internal `stats` handler remains unregistered; options have the stated ranges/choices; help lists prefix aliases without duplicate roots. |
| Levels math | Table-driven XP/level boundaries at 0, 99, 100, 399, 100,000, and level 999 cap; multiplier order, stack toggle, role thresholds, message variables, and 2,000-character validation. |
| Event ingestion | Bot/DM/ignored filtering; one XP cooldown; voice mute/alone/minimum/session split; membership baseline; stable message IDs and state-driven reaction/voice/member dedupe; duplicate/retry delivery produces one counter. |
| Persistence | Fresh and upgrade migrations preserve `member_levels`, existing `activity_logs`, and existing `/stats` output; unique guild/user/date and guild/event keys reject cross-guild collisions; transactions do not partially award XP. |
| Analytics | Exact daily sums for messages, reactions, voice minutes, joins, leaves, and snapshots; unavailable-history labels; 1/60/1,095 range boundaries; prune deletes only old daily rows and is resumable. |
| Live boards | 5-minute scheduler, one board identity, actor/guild binding, stale/deleted-message recreation, deterministic pagination/ties, and no duplicate boards on retries. |
| Logging | Union module choices and aliases; channel cap 15; add/move/remove/view/color/ignore responses; no-argument remove confirmation; outbox retry/dedupe; inaccessible channel and missing audit-log handling. |
| RBAC and safety | Caller and bot permission checks are path-specific; role hierarchy is rechecked; all destructive actions require the exact confirmation; logs cannot recurse on bot messages or leak another guild's data. |
| Runtime | Only after this contract is accepted: focused unit/integration checks, generated command inspection, and a user-approved Discord test-guild proof for level awards, analytics events, live boards, and logging delivery. |
