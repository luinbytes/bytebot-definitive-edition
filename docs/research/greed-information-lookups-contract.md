# Greed information and lookup compatibility contract

Issue: [#51](https://github.com/luinbytes/bytebot-definitive-edition/issues/51)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for Greed's public information, identity,
server-asset, and general-lookup family. It covers profile, avatar, banner,
role, invite, name, server, screenshot, QR, calculation, weather, definition,
and translation. It does not claim that Greed's prefix commands are Discord
slash commands. The ByteBot paths below are the discoverable slash surface;
only direct paths ByteBot already had remain loaded as compatibility handlers.

## Evidence and precedence

| Source | What it establishes | Limitation |
| --- | --- | --- |
| [Greed command catalog](https://greed.best/commands) | The current public catalog says it includes arguments and permissions for every command. | The catalog is client-rendered; its HTML does not expose the command records during this research. It is not used to invent missing option or permission data. |
| [Greed Information guide](https://greed.best/docs/miscellaneous/information) | Information covers members, avatars/banners, name history, server overview/assets/roles/channels/invites, and analytics. It says almost all information commands work for anyone; commands needing permission are marked in the guide. | The rendered page does not enumerate each command's options or permission marker. |
| [Greed Utility guide](https://greed.best/docs/miscellaneous/utility) | Utility is the home for practical tools. | It does not document this issue's complete command list. |
| [Greed homepage](https://greed.best/) | Current marketing claims for avatar/banner/server assets, weather, Urban Dictionary, translation, screenshots, and related tools. | Marketing copy is feature-family evidence, not a behavioral contract. |
| [Official `greedbest/docs` utility guide](https://github.com/greedbest/docs/blob/60cf7138d45a74bf0cf3fc749c1dc6c43b00df43/miscellaneous/utility.mdx) | The older public syntax `,translate (text)` and automatic translation to English. | This conflicts with the newer pinned translation registry. The pinned registry wins for the current target-language form; the conflict is retained below. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) | Exact current names, descriptions, response fields, errors, and the explicitly named options for this family. | Localization proves a public command path, not registration, Discord option requiredness, RBAC, cooldowns, or hard limits. |
| [Discord User resource](https://docs.discord.com/developers/resources/user) | User objects expose IDs, usernames, global names, avatar/banner hashes; username and nickname lengths; user lookup endpoint boundaries. | Discord user data does not provide Greed's historical-name store. |
| [Discord Guild resource](https://docs.discord.com/developers/resources/guild) | Guild/server objects, public preview fields, guild/member/role/channel/invite relationships, and official server limits/fields. | A guild preview is not a substitute for Greed's own lookup service. |
| [Discord Invite resource](https://docs.discord.com/developers/resources/invite) | Invite lookup is an external Discord API result with expiry, guild, and approximate-count fields where available. | Discord may reject expired, unknown, or inaccessible invites. |
| [Discord Message resource](https://docs.discord.com/developers/resources/message) | Message/embed/attachment constraints used to bound responses. | It does not define Greed's output card layouts. |
| [Discord application commands](https://docs.discord.com/developers/interactions/application-commands) | Slash-command nesting and option-type constraints. | The ByteBot slash mapping is an implementation choice, not a claim about Greed's registration. |

The pinned files used for the exact strings are:

- [`information/avatar.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/avatar.json)
- [`information/banner.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/banner.json)
- [`information/roleinfo.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/roleinfo.json)
- [`information/inrole.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/inrole.json)
- [`information/permissions.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/permissions.json)
- [`information/invite.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/invite.json)
- [`information/inviteinfo.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/inviteinfo.json)
- [`information/namehistory.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/namehistory.json)
- [`information/serverinfo.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/serverinfo.json)
- [`information/guildstats.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/guildstats.json)
- [`information/screenshot.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/screenshot.json)
- [`information/weather.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/weather.json)
- [`information/urbandictionary.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/urbandictionary.json)
- [`information/userinfo.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/userinfo.json)
- [`information/guildicon.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/guildicon.json)
- [`information/guildbanner.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/guildbanner.json)
- [`information/serveravatar.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/serveravatar.json)
- [`information/serverbanner.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/serverbanner.json)
- [`utility/calculate.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/calculate.json)
- [`utility/qr.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/qr.json)
- [`utility/translate.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/translate.json)

## Public command matrix

The `Greed path` column is the public command name in the pinned registry.
The parentheses are the documented user-facing argument grammar where the
registry or its response strings establish it. `Public limits` reports only a
published Greed limit. `ByteBot boundary` is an explicit local safety limit;
it must never be described as a Greed limit.

| Greed path | Pinned public behavior | Recommended ByteBot slash path and options | Greed permission evidence | Public limits / ByteBot boundary |
| --- | --- | --- | --- | --- |
| `userinfo` (profile) | View information about a user; includes created/joined/boosted/roles fields. | `/me info` (existing hub); optional `user` User option, default invoker. Preserve the legacy loaded `/userinfo` handler and its `target` option. | No command-specific permission in the registry; Information guide says almost all lookups work for anyone. | No public cap. ByteBot emits only real member fields, at most 20 roles plus a count, and Discord-sized embed fields. |
| `avatar` | View your avatar or a user's. | `/me avatar` (existing hub); optional `user` User option, default invoker. Preserve the legacy loaded `/avatar` handler. | No elevated permission published. | No public image-size/dimension limit. Use Discord CDN URLs, no arbitrary fetch; one response image. |
| `banner` | View your banner or a user's; explicit no-banner error. | `/me banner`; optional `user` User option, default invoker. | No elevated permission published. | No public image-size/dimension limit. Missing banner is a diagnostic, not a fabricated placeholder. |
| `serveravatar` / `serverbanner` | View the invoker's or a member's server avatar/banner; both explicitly require a server and report guild-only/no-asset errors. | `/me server-avatar` / `/me server-banner`; optional `user` User option, default invoker. Guild-only. | No elevated actor permission published; bot must be in the guild and able to resolve the member. | No public cap. Use only the current guild-member asset exposed by Discord; do not substitute the global user asset. |
| `roleinfo` | View information about a role; missing role falls back to a role the user has, otherwise errors. | `/server role info`; optional `role` Role option. | No elevated permission published. | No public field limit. ByteBot bounds dangerous-permission display to Discord's permission names and the embed field limit. |
| `inrole` | Show who is in a role; missing role has the same fallback; empty roles report no members. | `/server role members`; optional `role` Role option. | No elevated permission published. | No public member-list cap. ByteBot paginates and never prints more than 25 mentions per page. |
| `permissions` | View the invoker's or a member's permissions; explicit not-a-member/no-permissions errors. | `/server permissions view`; optional `user` User option, default invoker. | No elevated permission published. | No public permission-list cap. ByteBot reports only Discord permissions for a resolved guild member. |
| `invite` | Invite the bot to a server; no input option; response contains an Invite button. | `/server invite bot`; no options. | No elevated permission published; this is an OAuth invite link. | No public limit. The URL is generated from ByteBot's application ID and never accepted from user input. |
| `inviteinfo (invite)` | View invite information; explicit required invite code or URL, invalid-invite, and fetch-failed errors; card shows code, expiry, server, members, and online count. | `/server invite info`; required `invite` String option. | No elevated permission published. | Greed publishes no code/URL length or expiry cap. ByteBot accepts an absolute `discord.gg`/`discord.com/invite` URL or code up to 2048 characters, performs one bounded Discord lookup, and reports unavailable data. |
| `namehistory` | View a user's name history; optional target implied by title/no-user response. | `/me name history`; optional `user` User option, default invoker. | No elevated permission published. | No public retention or row limit in the command contract. ByteBot caps output at 25 rows per page and uses only its own recorded history; no row is invented from current Discord state. |
| `serverinfo (server)` | View server information. The registry exposes optional `server` (“server ID to view information about”) and explicit errors for unavailable guild, invalid invite/vanity, features, and no features. | `/server info` (existing hub); optional `server` String option for guild ID or vanity/invite. Preserve the legacy loaded `/serverinfo` handler. In current-guild context, omit it. | No elevated actor permission published. The bot must be in the guild or have a valid public lookup route. | No public field/card limit. ByteBot displays only fields returned by Discord and bounds lists to embed limits; unavailable external guild data is a diagnostic. |
| `guildicon` / `guildbanner` | View a server icon/banner using its ID or vanity URL; explicit invalid-server/no-asset errors. | `/server asset icon` / `/server asset banner`; optional `server` String option, default current guild. | No elevated permission published. | No public image cap. Validate a Discord guild ID or vanity/invite form; do not fetch arbitrary image URLs. |
| `guildstats` | Displays joins, leaves, and total members for the server. | `/server stats` (existing hub); no options. Reuse the existing stats handler. Issue #50 owns the persisted membership metrics and already carries the joins/leaves implementation; #51 owns only discovery/routing reuse so the two open PRs do not duplicate the same storage changes. | Viewing is not documented as privileged. Existing collection enable/disable remains Manage Server per the current ByteBot stats contract. | Public metric set is exactly total members, joins, leaves. Historical range, retention, chart layout, and card options are not published by this command. |
| `screenshot (URL)` | Capture a screenshot of a website; explicit invalid URL, service-unavailable, fetch-failed, and NSFW errors. | `/lookup screenshot`; required `url` String option. | No elevated permission published. | Greed publishes no URL, viewport, format, or image-size cap. ByteBot accepts HTTPS only, pre-rejects private/link-local destinations and non-web schemes, times out its provider request at 10 s, rejects provider redirects, and streams at most 8 MiB. The separately deployed browser provider must independently reject private/link-local targets, target redirects, and DNS rebinding; an opaque provider cannot be network-pinned by ByteBot. A provider failure is surfaced. |
| `qr (URL)` | Generate a QR code for a website URL; explicit required URL and `http://` or `https://` validation errors. | `/lookup qr`; required `url` String option. | No elevated permission published. | The registry explicitly requires `http://` or `https://`. ByteBot caps the URL at 2048 characters and generated image at 8 MiB; QR generation must not fetch the target. |
| `calculate (expression)` | Evaluate a mathematical expression; explicit usage and invalid-expression errors. | `/lookup calculate`; required `expression` String option. | No elevated permission published. | Greed publishes no expression/result limit. ByteBot accepts at most 500 characters, only a non-network arithmetic grammar, and a finite result rendered within 512 characters; no `eval`, code, variables, or external calls. |
| `weather (location)` | Check current weather for a location; explicit missing-location, not-found, API-not-configured errors; fields are temperature, wind, humidity, sunrise, sunset, visibility. | `/lookup weather`; required `location` String option. | No elevated permission published. | Greed publishes no location length, units, provider, or rate limit. ByteBot caps location at 100 characters, bounds provider JSON to 2 MiB/10 s, and reports missing configuration/provider failure instead of guessing. |
| `urbandictionary (word)` (definition) | Define a word with Urban Dictionary; explicit missing-word, no-definitions, and provider-failure errors; card includes definition, example, and votes. | `/lookup definition`; required `word` String option. | No elevated permission published. | Greed publishes no result count or text cap. ByteBot requests one term, caps the term at 100 characters, returns at most 5 definitions, and truncates each definition/example to Discord embed field limits without changing meaning. |
| `translate (target language) (text)` | Pinned registry says target language plus text, or reply to a message with target language; accepts language code or full name and reports invalid language/no text/API failure. | `/lookup translate`; required `language` and `text` String options. | No elevated permission published. | Greed publishes no language-list, text-length, or rate limit. ByteBot accepts language code/name up to 50 characters and text up to 2,000 characters, bounds provider responses to 2 MiB/10 s, and reports provider errors. |

### Translation conflict

The current pinned registry's error usage is the most specific current
evidence: `translate (target language) (text)` or a reply with
`translate (target language)`. The official docs repository's older utility page
instead says `,translate (text)` and automatic translation to English. ByteBot
implements the pinned target-language form and may retain auto-English as an
explicit compatibility alias only if it is labeled as an older Greed syntax;
it must not silently reinterpret a supplied target language.

## Slash discovery and category placement

The existing command-hub design uses `/me` for personal actions and `/server`
for server information. General provider-backed tools do not fit an existing
area, so ADR-0002 permits the single new `/lookup` Intent Hub:

| Help category | Discoverable paths | Loaded compatibility handlers |
| --- | --- | --- |
| Information > Members | `/me info`, `/me avatar`, `/me banner`, `/me name history`; `/me server-avatar`, `/me server-banner` | Existing `/userinfo`, `/avatar` |
| Information > Server | `/server info`, `/server stats`, `/server role info`, `/server role members`, `/server permissions view`, `/server invite bot`, `/server invite info`, `/server asset icon`, `/server asset banner` | Existing `/serverinfo`, `/stats` |
| Information > Web and external lookup | `/lookup screenshot`, `/lookup weather`, `/lookup definition` | None |
| Utility > Text and media | `/lookup calculate`, `/lookup qr`, `/lookup translate` | None |

Discord permits one optional subcommand group and one subcommand. That is why
`/server role info` and `/me name history` are valid, while a third nested
word is represented by a typed option or a flattened alias. Every path must
appear in `/help`, carry a stable source-category label (`information` or
`utility`), and route to one shared handler. Existing loaded compatibility
handlers must not fork behavior.

No synthetic `/information` or `/utility` top-level hub is required by the
source contract. One `/lookup` hub covers the otherwise homeless external
tools without registering six unrelated top-level commands.

## Permission and provider boundary

Greed's Information guide says almost all commands are available to everyone,
but the public sources do not attach a complete per-command RBAC table to this
family. Therefore ByteBot's default actor policy is read-only/public for all
rows above, with these non-negotiable platform checks:

- Guild-only lookups require a guild interaction and a resolved member/role;
  a missing bot membership, cache miss, denied Discord fetch, or invalid
  identifier is a diagnostic.
- `/server stats` viewing is read-only. Enabling/disabling analytics continues
  to use the existing Manage Server/path-aware RBAC contract and is not widened
  by this issue.
- Discord data is authoritative for current users, members, roles, guilds,
  assets, invites, and permissions. External providers are authoritative only
  for their bounded response; missing credentials, timeout, invalid payload,
  NSFW/provider rejection, and rate limiting become clear errors.
- ByteBot URL fetchers must use an explicit allowlist of schemes, reject
  loopback, private, link-local, metadata, and other non-public destinations,
  enforce redirect and response-size bounds, and never log credentials or full
  provider payloads. The screenshot browser is a separate deployment boundary
  and must enforce the same target/redirect/DNS policy itself.
- No external lookup may fabricate a result from a stale cache after the
  provider says not-found. A cached response may be used only when its freshness
  and provenance are explicitly recorded by the implementation.

## Acceptance checks

Before implementation is considered complete, tests must prove:

1. Every mapped ByteBot path serializes as a valid slash command and appears
   in help; existing loaded compatibility handlers route to the same behavior.
   The `/server stats` membership fields are verified by issue #50, while this
   issue verifies that the existing handler remains the shared route.
2. Optional target defaults and required `invite`, `server`, `url`,
   `expression`, `location`, `word`, and `language`/`text` validation follow
   this contract.
3. Discord identifiers, role/member scope, URL schemes, private-network
   rejection, redirects, response sizes, provider payload schemas, and Discord
   embed/attachment limits fail closed.
4. Missing banner/icon/definition/weather/provider data returns the documented
   diagnostic and never a placeholder presented as real data.
5. External provider failures are bounded and do not leave a deferred
   interaction unresolved.

The live Discord test suite is intentionally outside this research gate. It
requires an explicitly approved development guild and runtime credentials;
local mocked/provider-contract tests are sufficient for the implementation
PR.
