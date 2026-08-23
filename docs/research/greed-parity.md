# Greed parity research

Research date: 2026-08-23. Sources below are first-party unless explicitly marked as a gap. The requested URL `/comands` is not the canonical page (it returns 404); the live page is [`/commands`](https://greed.best/commands).

## Executive findings

- The live catalog currently advertises **945 commands**. Its rendered category labels expose counts for 17 categories: Information 86, Utility 80, Moderation 80, Fun 55, Economy 38, Roleplay 3, Security 82, LastFM 65, Logs 5, Voice 29, Auto 45, Server 164, Settings 47, Levels 3, Socials 31, Manipulation 99, and Snipe 4. These displayed counts sum to 916, leaving 29 commands unaccounted for. The page does not identify the missing bucket; do not assume it is NSFW merely because an `nsfw` command appears in the crawler sample.
- The catalog is client-rendered and Cloudflare-protected. Its public crawler output exposes command names, a short description, arguments, and permissions for only a small moving sample; no public first-party JSON/OpenAPI command registry was discoverable. The exact 945-name list, aliases, option types, default permissions, scopes, and premium flags therefore remain **unverified**.
- Greed's public docs use the comma prefix (``,``), and a live first-party social-feeds page says Greed has reached Discord's 100 slash-command cap; Pinterest, SoundCloud, and Kick are therefore prefix-only (or dashboard) surfaces. This explains why the 945-item catalog cannot be treated as 945 slash commands. Exact registration metadata and visibility for the rest remain unverified.
- A pinned first-party [`greedbest/i18n` commit](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f) labels English as the complete base language and contains **912 English command JSON files**, including [`uwulock.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/uwulock.json) and [`uwuify.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/uwuify.json). This corrects the earlier uwulock evidence gap, but the i18n snapshot and live 945-item catalog are different artifacts and dates; do not subtract them to infer a missing-command list.
- The pinned registry exposes `uwulock add`, `uwulock remove`, `uwulock list`, `uwulock protect add`, `uwulock protect remove`, `uwulock protect list`, and a separate `uwuify` command. It does not, by itself, establish option types, permissions, transformation algorithm, runtime edge behavior, or premium entitlement. The supplied screenshot remains visual evidence of a webhook-looking replay, not a complete behavior contract.

## Live catalog evidence

The current [`Greed command catalog`](https://greed.best/commands) says it shows every command with arguments and permissions and renders these category counts:

| Category as rendered | Count |
| --- | ---: |
| Information | 86 |
| Utility | 80 |
| Moderation | 80 |
| Fun | 55 |
| Economy | 38 |
| Roleplay | 3 |
| Security | 82 |
| LastFM | 65 |
| Logs | 5 |
| Voice | 29 |
| Auto | 45 |
| Server | 164 |
| Settings | 47 |
| Levels | 3 |
| Socials | 31 |
| Manipulation | 99 |
| Snipe | 4 |
| **Displayed subtotal** | **916** |
| **Catalog total** | **945** |

The same page's indexed sample exposes these exact entries, but this is not a complete list:

| Command/subcommand | Arguments shown | Permission shown | Description shown |
| --- | --- | --- | --- |
| `nsfw` | `(channel)` | None | Mark a channel as NSFW or SFW |
| `happy`, `wall`, `hearts`, `neon`, `infinity`, `optics` | `[member]` or `[user]` | None | No description |
| `wiggle`, `peck`, `lurk`, `wink`, `sleep` | `[member]` | None | No description |
| `help` | `[command]` | None | Shows help about the bot, a command, or a category |
| `warp` | `[user]` | None | No description |
| `inrole` | `(role)` | None | Show who is in a role |
| `autorole add` | `(roles)` | None | Add roles to the autorole list |
| `autorole list` | None | None | List roles currently configured as autoroles |
| `autorole remove` | `(roles)` | None | Remove roles from the autorole list |
| `autorole clear` | None | None | Clear all autoroles in this server |
| `pagination add` | `(message id) (script)` | None | Add a new page to a pagination embed |

The catalog page does not state whether “None” means no Discord permission, no Greed-specific permission, or only that the crawler omitted a permission. Preserve that distinction in any importer.

## Pinned first-party i18n registry

The public [`greedbest/i18n` repository](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f) is a first-party command-localization source. At pinned commit [`3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/commit/3dadc41852a09567add8a6b2b522d5e2b1a53b2f) (2026-03-29), its README calls `locales/en` the “English (base language - always complete)” locale and describes `locales/<language>/commands/<category>` as the command-message layout. Counting the pinned tree gives **912** JSON files below `locales/en/commands`:

| i18n category directory | English JSON files |
| --- | ---: |
| auto | 55 |
| boosters | 3 |
| developer | 4 |
| economy | 50 |
| fun | 71 |
| information | 48 |
| lastfm | 22 |
| levels | 8 |
| logs | 7 |
| manipulation | 3 |
| moderation | 101 |
| music | 9 |
| roleplay | 1 |
| security | 102 |
| server | 214 |
| settings | 42 |
| snipe | 5 |
| socials | 11 |
| utility | 123 |
| voice | 33 |
| **Total** | **912** |

These are localization files, not a guaranteed command-registration export. The live website advertises 945 catalog entries, while this pinned snapshot has 912 English command files; the artifacts use different category taxonomies and dates, so the difference is not evidence of exactly 33 missing commands.

### Verified uwulock/uwuify registry surface

The pinned [`uwulock.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/uwulock.json) contains these command names and descriptions:

| Surface | Registry evidence | What is not established by this file |
| --- | --- | --- |
| `uwulock add` | Add a user to uwulock | Argument type, caller permission, scope, persistence, and failure behavior |
| `uwulock remove` | Remove a user from uwulock | Same unknowns |
| `uwulock list` | List all uwulocked users | Ordering, pagination, invalid-member handling, and visibility |
| `uwulock protect add` | Protect a user from being uwulocked | Same unknowns |
| `uwulock protect remove` | Remove protection from a user | Same unknowns |
| `uwulock protect list` | List all protected users | Ordering, pagination, invalid-member handling, and visibility |
| `uwuify` | Separate command: “Make a message uwuified” | Text/message option type, algorithm, attachment handling, and failure behavior |

This corrects the earlier “not found” conclusion: the feature is confirmed in the pinned first-party localization registry, even though it was absent from the small live-page crawler sample. The i18n files provide command names, descriptions, and response strings; they do not prove Discord option types, RBAC, channel/thread/DM scope, exemption rules, premium gating, transformation algorithm, or runtime edge behavior. The live catalog may have drifted since the 2026-03-29 snapshot.

## First-party feature and command matrix

The canonical docs index is [`docs.greed.best/llms.txt`](https://docs.greed.best/llms.txt). It links feature guides, but not a machine-readable 945-command registry. The following matrix is the **documented subset** and the exact syntax/options visible in those guides.

| Area | Documented commands or surfaces | Arguments/options and behavior | Access/premium evidence |
| --- | --- | --- | --- |
| Invocation | `,help`; mention the bot; comma prefix | Prefix is configurable with `,prefix set (symbol)` in the getting-started guide | Public docs; no slash metadata published |
| Moderation setup | `,setup`; `,setup reset`; `,jail @user [reason]`; `,jail channel #channel`; `,jail role @role` | Creates/configures `greed-mod`, `logs`, `jail`, and specialized `imute`, `rmute`, `jailed` roles | [`Moderation`](https://greed.best/docs/moderation/moderation); setup requires Administrator in the guide |
| Moderation invoke | `,invoke (action) dm (message)`; `,invoke (action) message (message)`; `,invoke list`; `,invoke settings`; `,invoke test (action)`; `,invoke variables` | Actions documented: `ban`, `kick`, `timeout`, `softban`, `hardban`, `imute`, `rmute`, `untimeout`, `iunmute`, `runmute`; templates support user/guild/reason/moderator variables | [`Moderation`](https://greed.best/docs/moderation/moderation) |
| Moderation safety | `,strip (user) [reason]`; `,settings modlog`; `,settings resetcases`; `,settings imuted`; `,settings rmuted`; `,settings jail`; `,settings staff add/list/remove`; `,settings warn punishment add/list/remove` | Warning thresholds can trigger `timeout` (with duration), `kick`, `jail`, `hardban`, `softban`, or `ban` | [`Moderation`](https://greed.best/docs/moderation/moderation) |
| Antinuke | `,antinuke admin (@user)`; `,antinuke whitelist (userid)`; module toggles/config; `,antinuke config` | Documented modules include guild updates, bans, channels, invites, bot additions, and a generic `(module) (status) (punishment)` / `threshold` form | [`Antinuke`](https://greed.best/docs/moderation/antinuke); exact module set is not guaranteed by the catalog sample |
| Antiraid | `,antiraid toggle on`; `massjoin`, `avatar`, `age`, `massmention`, `unverifiedbots`, `username`, `state`, `whitelist` | Module status, `--threshold`, `--do`, `--lock`, `--punish`; username add/remove/list/action; state on/off; whitelist toggles a user | [`Antiraid`](https://greed.best/docs/moderation/antiraid); some modules are marked premium |
| Automod/content filters | `,filter spam/caps/emoji/massmention/spoilers/images/invites/links/repetition/walloftext`; `add/remove/list/whitelist/exempt`; `filter regex`; `filter strikes` | Status/target/threshold forms; keyword blacklist; named regex add/remove/list/test; strikes toggle/set/decay/cap/view/reset/settings | [`AutoMod`](https://greed.best/docs/moderation/automod); advanced content filters are marked premium in the current premium page |
| Fake permissions | `,fakepermissions add (role) (permissions)`; `remove`; `list`; `reset` | Comma-separated virtual Discord permission names; affects only Greed's command checks | [`Fake Permissions`](https://greed.best/docs/moderation/fakepermissions); does not grant the real Discord permission needed for API actions |
| Music/voice | `,play (query or URL)`; `,skip`; `,queue`; `,volume (0-200)`; `,settings dj (role)`; `,settings autoplay (status)`; `,voicemaster setup`; `,voicemaster template`; `,voicemaster default` | Playback, queue, volume, DJ role, autoplay; VoiceMaster creates/manages temporary voice channels | [`Music`](https://github.com/greedbest/docs/blob/main/miscellaneous/music.mdx), [`VoiceMaster`](https://github.com/greedbest/docs/blob/main/configuration/voicemaster.mdx) |
| Last.fm | `,lastfm login`; `,lastfm set (username)` | Links/configures Last.fm; homepage also advertises now-playing, recent tracks, profiles, leaderboards, crowns, collages, and music playback | [`Last.fm`](https://github.com/greedbest/docs/blob/main/miscellaneous/lastfm.mdx); homepage feature copy is broader than the guide |
| Welcome/leave/system | `,welcome channel/message/test/view`; `,goodbye channel/message/test/view`; `,set system [channel]`, `,set system welcome`, `,set system boost` | Message templates, embeds, variables, and optional auto-delete are documented | [`Welcome`](https://github.com/greedbest/docs/blob/main/server-configuration/automation/welcome.mdx), [`Leave`](https://github.com/greedbest/docs/blob/main/server-configuration/automation/leave.mdx), [`System`](https://github.com/greedbest/docs/blob/main/configuration/messages/system.mdx) |
| Automation | `,autoresponder add`; `,autoreact add`; `,autoreact channels add/remove/list`; `,autoreact roles add/remove/list`; `,timer add/list/remove`; `,bumpreminder enable/reminder/thankyou` | Trigger/response flags include `--reply` and `--strict`; timers use channel/interval/message; autoreact can be constrained by channel/role | [`Responder`](https://github.com/greedbest/docs/blob/main/configuration/messages/responder.mdx), [`Reaction triggers`](https://github.com/greedbest/docs/blob/main/configuration/reaction-triggers.mdx), [`Timer`](https://github.com/greedbest/docs/blob/main/configuration/messages/timer.mdx) |
| Roles/reactions | `,reactionrole add/list/remove/clear`; `,buttonrole add`; `,boosterrole setup/base/create`; `,br color/rename/icon/hoist/share/filter` | Reaction role uses message link, emoji, role; button role uses message link, role, optional style/emoji/label; booster role supports colors/icons/filters | [`Reaction roles`](https://github.com/greedbest/docs/blob/main/configuration/roles/reaction.mdx), [`Button roles`](https://github.com/greedbest/docs/blob/main/configuration/roles/button.mdx), [`Booster role`](https://github.com/greedbest/docs/blob/main/configuration/roles/booster.mdx) |
| Starboard/levels/logs | `,starboard add (emoji) #channel`; `,levels setup`; `,level [@user]`; `,levels leaderboard [total/text/voice]`; `,levels roles`; `,levels boost add`; `,levels award`; `,levels ignore`; `,logs add/view/remove`; `,settings modlog` | Reaction thresholds/channels, text/voice level leaderboards, role/channel multipliers, ignored channels, module logs | [`Starboard`](https://github.com/greedbest/docs/blob/main/configuration/starboard.mdx), [`Levels`](https://github.com/greedbest/docs/blob/main/configuration/levels.mdx), [`Logging`](https://github.com/greedbest/docs/blob/main/configuration/logging.mdx) |
| Giveaways/counting | `,giveaway start (duration) (winners) (prize) @Role`; `,counter add (metric raw) (kind raw)` | Example giveaway includes optional role; counter example tracks `members voice` | [`Giveaway`](https://github.com/greedbest/docs/blob/main/miscellaneous/giveaway.mdx), [`Counting`](https://github.com/greedbest/docs/blob/main/miscellaneous/counting.mdx) |
| Custom scripts/embeds | `,createembed`; `,pagination set/add/update`; Components V2 (`{cv2}`) and embed scripting | Buttons, sections, containers, galleries, variables, pagination; scripts can render ephemeral replies and be attached to buttons | [`Embeds`](https://greed.best/docs/resources/scripting/embeds), [`Components`](https://greed.best/docs/resources/scripting/components), [`Pagination`](https://github.com/greedbest/docs/blob/main/resources/scripting/pagination.mdx) |
| Alias/restriction | `,alias add/list/remove/removeall/reset`; `,disable`/`,enable`; `,restrict`; `,denyperm`; `,protect` | Server-specific aliases; disable server/channel/role with whitelist; allow/deny role restrictions; block dangerous role permissions; protect members/roles | [`Command aliases`](https://greed.best/docs/configuration/command-aliases), [`Command permissions`](https://greed.best/docs/configuration/command-permissions) |
| Miscellaneous | AFK, snipe, birthday, censor, reminder, thread, confessions, emoji/sticker, word statistics, ticket, vanity, autopfp, tracking, join-to-leave | The docs index links each feature, but the command page does not expose a complete stable syntax export | [`Docs index`](https://docs.greed.best/llms.txt) |

The public docs' source repository is [`greedbest/docs`](https://github.com/greedbest/docs). It is useful for command syntax, but it does not contain the live catalog's 945-command registry. Several website docs and the GitHub repository also disagree in examples/coverage; use the live catalog for current counts and the specific page cited for syntax.

## Homepage feature claims not represented by the documented subset

The current homepage advertises these product areas: Last.fm; Spotify; X; TikTok; GitHub; Roblox; Rolimons; Valorant; Fortnite; Minecraft; crypto; AI questions/image generation/image editing/OCR/TTS; over 100 image filters/effects; fun commands (8-ball, ship, roll, coinflip, meters); interactions (hug/kiss/pat/slap); weather; Urban Dictionary; avatar/banner/server assets; reminders; snipe; translation; screenshots; custom embeds; analytics for messages, reactions, voice, and membership; and a Last.fm/Lavalink player. These are marketing claims, not a command-by-command contract. See [`greed.best`](https://greed.best/).

## Premium parity matrix

There are conflicting first-party pages. The current site page is the strongest evidence for present-day behavior, but the older docs page and FAQ must be preserved as conflicts rather than silently merged.

### Current `greed.best/docs/premium` claims

Source: [`Premium`](https://greed.best/docs/premium).

| Product/tier | Free baseline | Premium claim |
| --- | --- | --- |
| User command rate limit | 5 commands / 5 seconds | Voting: 10; User Premium: 15 |
| AI `ask` | 15/day | 200/day |
| AI `imagine` | unavailable | 30/day |
| AI `tts` | 5/day | 50/day |
| AI `transcribe` | 5/day | 50/day |
| AI `ocr` | 10/day | 100/day |
| User extras | — | Custom AFK embeds, rank-card styling, snipe protection, 1.5× economy earnings, purge filters |
| Server log channels | 4 | 15 |
| Server autoroles | 2 | 50 |
| Reaction roles | 50 | 500 |
| Autopfp channels | 1 | 15 |
| Analytics retention | 60 days | 3 years |
| Server rate limit | 30 / 10 seconds | 60 / 10 seconds |
| Server protection | Antinuke is available to all; base features | Premium antiraid join-rate thresholds, new-account gating, username filters, mass-mention defense, advanced content filters (keyword/regex/strike) |
| Server-only features | — | Backups, social feeds, giveaway extras, VoiceMaster extras, server discovery, server stats card |
| Customize add-on | — | Per-server nickname/avatar/banner, bio up to 190 chars, card font/effect |
| Billing surface | — | `,premium user` / `,premium guild`; Discord purchase buttons plus external card/crypto options are described |

The page says User Premium follows the account across servers, Server Premium applies to one server and raises caps for everyone, and Customize is a one-time per-server add-on. It does **not** document a `uwulock` entitlement or command.

### Older premium/docs claims (conflicting, not confirmed current)

The older [`docs.greed.best/premium/overview`](https://docs.greed.best/premium/overview) page says User Premium costs monthly $3.50/yearly $15/one-time $25 and Server Premium costs monthly $7.50/yearly $25/one-time $50. It additionally claims self-purge/reskin, extra giveaway/starboard capacity, automatic server snapshots and restore, 1,000 autoreactions/autoresponders, JoinDM, multiple autobanner/autopfp channels, editable VoiceMaster, social reposting, decreased cooldowns, economy multipliers, and custom webhook embeds. Those details conflict with the current page's tier/cap table and must not be implemented as current 1:1 behavior without live verification.

The older [`FAQ`](https://docs.greed.best/resources/faq) says Greed “currently does not have any premium features,” which directly conflicts with both the current premium page and the premium page above. The FAQ is stale or from a different deployment; it is retained here as a source conflict.

## Uwulock-specific evidence and gaps

| Question | Evidence | Status |
| --- | --- | --- |
| Is `uwulock` in a first-party command registry? | The pinned [`greedbest/i18n` English registry`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/uwulock.json) contains it, correcting the earlier gap | **Confirmed in the 2026-03-29 public snapshot; the current catalog crawler sample does not expose it** |
| Exact command surface | `uwulock add`, `uwulock remove`, `uwulock list`, `uwulock protect add`, `uwulock protect remove`, and `uwulock protect list`; separate [`uwuify`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/uwuify.json) | **Confirmed names/descriptions in the registry; aliases unknown** |
| Option/argument types | The localization files contain names/descriptions and response strings, not Discord command-option definitions | **Unknown** |
| Who may add/remove/protect a member? | No uwulock permission or RBAC declaration was found in the pinned command-localization files or current premium page | **Unknown**; do not infer from another bot or screenshot |
| Scope and persistence | The strings say “in this server” for valid-user list results, but no storage, channel/thread/DM, or lifecycle contract is published | **Guild-oriented wording is evidenced; exact scope/persistence unknown** |
| Replay behavior | The `uwulock` description says “Uwuify a person's messages”; no contract for deletion, webhook identity, attachments, embeds, replies, edits, or failures | **Unknown** |
| Exemptions | No first-party evidence for bots, staff, channels, threads, DMs, protected roles, or message types | **Unknown** |
| Paywall | Current premium page does not mention uwulock or uwuify; the older premium pages do not mention them either | **Not evidenced as paid** |
| UwU transformation algorithm | No first-party algorithm/spec found; the screenshot is an example, not a specification | **Unknown** |
| Current drift | Live website advertises 945 catalog entries; pinned English i18n has 912 files from 2026-03-29 and different category names | **Snapshot evidence only; do not claim current 1:1 parity** |

The screenshot is consistent with a webhook replay, but Discord's API evidence below shows that this would be a webhook-authored message, not a message actually authored by the person being mimicked. The pinned registry confirms the command names but does not turn that visual example into a complete runtime contract.

## Discord implementation constraints (official sources)

### Receive and replace messages

- A Gateway app needs the message-create event. The `MESSAGE_CONTENT` privileged intent controls whether user-entered `content`, embeds, attachments, components, and poll data are delivered. Without it, Discord returns empty content fields except for messages the app sends, DMs with the app, messages that mention the app, and the message targeted by a message context-menu command. Source: [`Gateway intents and MESSAGE_CONTENT`](https://docs.discord.com/developers/events/gateway).
- Deleting another user's guild message requires `MANAGE_MESSAGES`; Discord's permission table describes this as allowing deletion of other users' messages. Source: [`Message resource`](https://docs.discord.com/developers/resources/message) and [`Permissions`](https://docs.discord.com/developers/topics/permissions).
- Any implementation must guard against replay loops. Webhook messages carry `webhook_id`; checking only the author’s bot flag is not a sufficient behavioral contract for deciding whether a message is an original user message. Source: [`Message resource`](https://docs.discord.com/developers/resources/message).

### Send a mimicked message

- `POST /webhooks/{webhook.id}/{webhook.token}` accepts `content` (up to 2,000 characters), `username`, `avatar_url`, attachments, embeds, and `allowed_mentions`; `wait=true` returns the created message. Source: [`Execute Webhook`](https://docs.discord.com/developers/resources/webhook).
- `username` and `avatar_url` override the webhook's defaults for that message. Discord states that a webhook-generated message's author is the webhook ID/name/avatar, and the message can be identified by `webhook_id`; this is visual impersonation, not author identity. Source: [`Webhook resource`](https://docs.discord.com/developers/resources/webhook) and [`Message resource`](https://docs.discord.com/developers/resources/message).
- Creating a channel webhook requires `MANAGE_WEBHOOKS`; the execute-token call itself uses the webhook token. A design that lazily creates one webhook per channel therefore needs a provisioning path and storage for webhook IDs/tokens, plus cleanup and rotation handling. Source: [`Create Webhook` / `Execute Webhook`](https://docs.discord.com/developers/resources/webhook).
- User-generated text should be sanitized and sent with an explicit `allowed_mentions` policy, because Discord specifically warns about unexpected mentions in webhook content. Source: [`Execute Webhook`](https://docs.discord.com/developers/resources/webhook).
- Discord's incoming-webhook guide describes webhooks as channel-bound incoming POST endpoints and says a bot is the better fit when the app also needs to listen/respond to events. Source: [`Webhooks platform guide`](https://docs.discord.com/developers/platform/webhooks).

### Slash-command display and RBAC

- Discord application commands are separate from prefix commands. `CHAT_INPUT` commands appear under `/`; user and message context commands appear under the Apps menu. Source: [`Application Commands`](https://docs.discord.com/developers/docs/interactions/slash-commands).
- Slash command and option names are 1–32 characters and must follow Discord's naming regex; descriptions are 1–100 characters; a command has at most 25 options. Subcommands and subcommand groups are first-class option types. Source: [`Application Commands`](https://docs.discord.com/developers/docs/interactions/slash-commands).
- Discord allows 100 global `CHAT_INPUT`, 15 global user, and 15 global message commands, with the same guild-specific limits; command creation has a 200-per-guild/day rate limit. This makes “945 separate slash commands” impossible as a direct registration strategy. Use grouped commands or a help/search surface if the bot needs many features. Source: [`Application Commands`](https://docs.discord.com/developers/docs/interactions/slash-commands).
- Greed's live [`Social Lookups & Feeds`](https://greed.best/docs/miscellaneous/socials) page explicitly says it is at Discord's 100 slash-command limit and consequently makes Pinterest, SoundCloud, and Kick prefix-only (or dashboard) surfaces. This is first-party evidence that Greed's catalog mixes invocation surfaces; it does not reveal the complete registration payload or per-command visibility.
- A command can set `default_member_permissions`; guild command permissions can allow/deny roles, users, and channels. If a user lacks permission, Discord does not show the command in the picker. Source: [`Application Commands`](https://docs.discord.com/developers/docs/interactions/slash-commands).
- Greed's own command-permission docs add server-side disable/restrict/whitelist/protect behavior, but these are Greed-specific checks and not the same as Discord's API permissions. Source: [`Command permissions`](https://greed.best/docs/configuration/command-permissions).

## Public-source parity contract for the bot team

Greed bot/server probing and live interaction testing are out of scope. For this work, the public first-party sources are the contract:

- the public live catalog's total and rendered category counts;
- the current official docs and their documented command/feature behavior; and
- the pinned official English i18n registry, including its 912 command JSON files and the verified uwulock/uwuify entries.

The live catalog advertises 945 entries, while the pinned i18n snapshot contains 912 English command files under a different category taxonomy and date. That is a documented artifact limitation, not a basis for inferring 33 missing commands or claiming that every catalog entry is a slash command.

Public-source parity means matching the verified names, category/feature families, documented invocation surfaces, and documented premium claims above. Any runtime detail absent from those sources—such as uwulock option types, RBAC, persistence, channel/thread/DM scope, exemptions, deletion/webhook replay behavior, attachment handling, transformation algorithm, or premium gating—is an explicit ByteBot implementation decision. It must be documented as ByteBot behavior, not presented as a Greed parity claim or inferred from the screenshot.

The implementation target is therefore:

1. Match the verified catalog counts/category names, current official docs, and pinned English i18n surfaces while preserving the 945-versus-912 limitation.
2. Keep every undocumented command, alias, option, premium flag, slash visibility rule, and uwulock runtime detail explicitly labelled as unknown in the Greed evidence and separately specified as a ByteBot decision before implementation.
3. Implement webhook replay only behind a guild-scoped opt-in, a clear audit trail, strict loop prevention, `MANAGE_MESSAGES` + `MANAGE_WEBHOOKS` checks, explicit mention sanitization, and a kill switch. Greed's “fake permissions” concept must not bypass Discord's real permissions.
4. Do not claim visual identity equals authorship: replayed messages are authored by a webhook and can be distinguished by `webhook_id`.
5. Revisit this contract only when a new public first-party source changes the catalog, docs, or i18n snapshot; no live Greed capture or test server is required to establish the public-source parity baseline.
