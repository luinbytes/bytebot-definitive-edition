# Greed snipe, fun, games, and roleplay contract

Issue: [#54](https://github.com/luinbytes/bytebot-definitive-edition/issues/54)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for Greed's public Snipe, roleplay, and
remaining Fun subjects. No production code or tests for #54 were changed or
run before this inventory was frozen. No live Greed bot or guild was queried.

## Source precedence and limits

| Source | What it proves | Limit |
| --- | --- | --- |
| [Current Greed command catalog](https://greed.best/commands) and its misspelled alias [`/comands`](https://greed.best/comands) | Greed presents a public command catalog. | Both routes currently stop at Cloudflare's `Just a moment...` challenge in a normal browser and return HTTP 403 to a direct fetch. They cannot supply reproducible command rows. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) | Names, descriptions, response fields, and public error text for 71 Fun files, five Snipe files, one Roleplay file, and `settings/snipeProtect.json`. | Localization is not runtime code. It does not prove slash option types, algorithms, storage bounds, cooldown durations, permissions, or provider implementation. |
| [Discord application commands](https://docs.discord.com/developers/docs/interactions/slash-commands) | A slash command may have at most 25 options; subcommand groups provide one nesting level; age-restricted content must use the command-level `nsfw` flag. | Discord does not define Greed semantics. |
| [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) and [Community Guidelines](https://discord.com/guidelines) | Applications must not enable harassment or give adult content to minors; hateful conduct and non-consensual sexual content are prohibited. | Policy does not make every joke, fictional game, or non-graphic roleplay action prohibited. |
| [NEKOSBEST API reference](https://docs.nekos.best/getting-started/api-reference), [endpoints](https://docs.nekos.best/getting-started/api-endpoints), and [terms](https://docs.nekos.best/legal/tos) at docs commit [`70794d4`](https://github.com/nekos-best/nekos-best-docs/tree/70794d4a821ba916d677d3dcca61b9902ee09165) | Keyless v2 response schema, current GIF categories, 200 requests/minute/category, required identifying User-Agent, attribution, non-commercial-use boundary, and no bulk scraping/caching. | The service is third-party and availability is not guaranteed. It cannot supply Greed's three explicit/missing roleplay subjects. |

The public contract is the pinned first-party registry. Where it does not
publish a value, the implementation below records a bounded ByteBot rule
instead of presenting an invented value as Greed behavior.

## Complete registry ownership

Every pinned file is assigned exactly once. A cross-issue mapping is not an
omission: it identifies the issue that owns the implementation and final
verification.

### Snipe and settings: six subjects

| Pinned subject | Public behavior | ByteBot path and rule |
| --- | --- | --- |
| `snipe/snipe.json` and duplicate `fun/snipe.json` | Show a deleted message by 1-based index in the current channel. | `/fun snipe deleted index`; member-accessible; current channel only. |
| `snipe/editsnipe.json` and duplicate `fun/editsnipe.json` | Show a prior edited message by 1-based index. | `/fun snipe edited index`; stores the pre-edit content only. |
| `snipe/reactionsnipe.json` and duplicate `fun/reactionsnipe.json` | Show a removed reaction by 1-based index. | `/fun snipe reaction index`; records emoji, reactor, message author, and message link. |
| `snipe/clearsnipe.json` and duplicate `fun/clearsnipe.json` | Clear deleted, edited, and reaction snipes for the current channel. | `/fun snipe clear`; requires Discord Manage Messages and path-aware ByteBot RBAC. |
| `snipe/index.json` | Footer labels Deleted, Edited, or Unreacted plus age, index, and total. | The embed retains those fields and suppresses mentions. |
| `settings/snipeProtect.json` | Self-service on/off/status protection; Greed's error advertises a vote-or-premium gate. | `/fun snipe protect mode:on|off|status`; available to every member without billing, voting, or entitlement checks. |

Snipe payloads are deliberately ephemeral: at most ten entries of each kind
per channel, retained for at most 15 minutes, in process memory only. Deleted
partials are never fetched, bot/webhook/system messages are ignored, and only
plain message content plus the minimum display metadata is retained. Files,
embeds, stickers, and attachment URLs are not copied. Protection is persistent
and global per Discord user; enabling it immediately removes that user's
cached entries. This privacy-minimizing bound is ByteBot-owned because Greed
publishes no retention limit or payload schema.

### Roleplay: one file, 43 action subjects

The pinned `roleplay/roleplay.json` exposes `list`, administrator `toggle`,
per-user and per-guild rate-limit errors, no-bot/no-self errors, per-pair action
counts, and these 43 actions:

`slap`, `hug`, `kiss`, `pat`, `tickle`, `feed`, `punch`, `highfive`, `bite`,
`shoot`, `wave`, `happy`, `peck`, `lurk`, `sleep`, `wink`, `yawn`, `nom`,
`yeet`, `think`, `bored`, `blush`, `stare`, `nod`, `handhold`, `smug`,
`shrug`, `poke`, `smile`, `facepalm`, `cuddle`, `baka`, `angry`, `run`,
`nope`, `handshake`, `cry`, `pout`, `thumbsup`, `laugh`, `fuck`, `spank`,
and `nutkick`.

Discord cannot register 43 sibling subcommands under one group. ByteBot maps
them to `/fun roleplay action action:<choice> member:<user>`, with autocomplete
for all enabled actions, plus `/fun roleplay list` and `/fun roleplay toggle`.
`toggle` requires Manage Server and the existing path-aware RBAC check; member
paths remain public. Bots and self-targets are rejected. Counters and per-guild
toggles are persistent. The existing per-user command cooldown is paired with
a ByteBot-owned 20-request/10-second guild window. Provider requests are
limited to one result, use a five-second timeout and the mandated identifying User-Agent, validate the JSON
and HTTPS result URL, never cache media, and credit NEKOSBEST in the response.

NEKOSBEST currently supplies 40 of the 43 actions. `fuck` is
`policy-excluded`: it is an explicitly sexual targeted action and `/fun` is
not an age-restricted command. `spank` and `nutkick` are `policy-excluded`:
the provider has no matching category and a fabricated or substituted image
would misrepresent the action; both are targeted sexual/violent harassment
surfaces. The remaining 40 are implemented as non-graphic fictional reactions
using the provider's exact categories. The provider is suitable only while the
bot is non-commercial under its current terms; a future commercial deployment
must disable the provider or replace it with a licensed source.

### Fun: all 71 pinned files

| Pinned files | Mapping |
| --- | --- |
| `8ball.json`, `eightball.json` | Existing `/fun 8ball`; aliases of one handler. |
| `uwuify.json`, `uwulock.json`, `text.json` uwu subject | Complete in #35; existing `/fun uwuify` and `/fun uwulock` stay canonical. |
| `choose.json`, `pick.json`, `poll.json`, `polls.json`, `quickpoll.json`, `quote.json` | Owned by #53's `/community` delivery; no duplicate handler in #54. |
| `diary.json`, `utility.json` diary subject | Owned by #52's `/me diary`; `utility.json` lyrics remains owned by #57. |
| `snipe.json`, `editsnipe.json`, `reactionsnipe.json`, `clearsnipe.json` | Duplicate aliases of the Snipe rows above. |
| `rps.json`, `tictactoe.json`, `blacktea.json`, `blacktea/index.json`, `blacktea/end.json`, `flag.json`, `flags.json`, `flags/index.json`, `flags/end.json`, `wyr.json`, `games.json` | `/fun game rps`, `tictactoe`, `blacktea`, `flags`, `flag`, `wyr`, and `end`. In-memory sessions are limited to one per channel and always expire. |
| `iq.json`, `randomhex.json`, `roast.json`, `simple.json` | `/fun meter iq`, `/fun randomhex`, and `/fun roast`; `simple.json` aliases these handlers plus existing 8-ball/RPS and cross-issue subjects. |
| `spark.json`, `smoke.json`, `taps.json` | `/fun blunt spark`, `smoke`, and `taps`; persistent per-user count with a bounded ByteBot-owned active window/cooldown because Greed publishes neither duration. This is fictional use only and has no sale/trade surface. |
| `vape.json`, `vape/index.json`, `vape/steal.json`, `vape/flavor.json`, `vape/hits.json` | `/fun vape hit`, `steal`, `flavor`, and `hits`; one persistent holder per guild and a bounded flavor choice list. This is fictional use only and has no sale/trade surface. |
| `howgay.json` | `policy-excluded`: assigning a sexual orientation percentage to a targeted member gamifies a protected characteristic and creates a harassment surface. |
| `pp.json`, `bitches.json` | `policy-excluded`: targeted sexual/anatomical and sexualized derogatory ratings cannot live in the non-age-restricted `/fun` command. |
| `nword.json`, `nwordlb.json` | `policy-excluded`: implementing them requires detecting, storing, ranking, and rewarding use of a racial slur, which would intentionally enable hateful/harassing behavior. |
| `alert.json`, `animate.json`, `calling.json`, `captcha.json`, `compress.json`, `didyoumean.json`, `distort.json`, `drake.json`, `drip.json`, `facts.json`, `gun.json`, `jumbo.json`, `modify.json`, `oogway.json`, `overlay.json`, `pooh.json`, `render.json`, `rotate.json`, `sadcat.json`, `scene.json`, `ship.json`, `supreme.json`, `wanted.json` | Owned by #56's bounded shared image/media seam; no second fetch/decode pipeline is added here. |
| `dominant.json` | Owned by #56 because it must decode an untrusted avatar image through that same bounded media seam. |
| `image.json` | Family/response localization for image generation and search; owned by #55/#56 and provider reconciliation #62. |
| `gang.json` | Duplicate Economy gang subject, complete in #49. |

This table accounts for all 71 Fun files. `simple.json`, `text.json`,
`utility.json`, and `games.json` are aggregate response registries rather than
additional standalone commands; their named subjects are mapped above.

## Game rules where Greed is silent

The public registry proves the presentation and broad rules but not its word
list, country set, challenge protocol, or random algorithms. ByteBot therefore
uses the following small, deterministic contract:

- RPS accepts exactly rock/paper/scissors and uses cryptographic uniform
  selection from those three choices.
- Tic-tac-toe is a two-member, nine-button challenge, one active game per
  channel, and expires after five minutes of inactivity.
- BlackTea waits up to 30 seconds for joins, starts with two lives, allows ten
  seconds per turn, rejects repeated words, and uses a bundled compact common
  English list. A valid word must contain the shown three-letter group.
- Multiplayer flags waits up to 30 seconds, starts each player with three
  lives, progresses easy/medium/hard at 10/8/7 seconds, and uses a bundled
  country-name/flag list. Single-player `flag` allows 30 seconds.
- Would You Rather uses a bundled neutral question list; it never claims an
  external response when no public provider is evidenced.
- A member with Manage Messages may end the current channel's BlackTea or
  flags game. A participant may also end their own game. Session maps and
  timers are bounded and cleared on shutdown or guild removal.

The compact bundled lists are a known content ceiling, not a hidden claim of
Greed data parity. They can be expanded from a legally redistributable source
without changing command behavior.

## Slash layout and RBAC

The existing `/fun` root remains the canonical hub. #54 adds six groups and
three direct member paths while remaining below Discord's 25-option limit:

| Root option | Nested paths | Access |
| --- | --- | --- |
| `snipe` | `deleted`, `edited`, `reaction`, `clear`, `protect` | Member except `clear`, which requires Manage Messages plus path RBAC. |
| `roleplay` | `action`, `list`, `toggle` | Member except `toggle`, which requires Manage Server plus path RBAC. |
| `game` | `rps`, `tictactoe`, `blacktea`, `flags`, `flag`, `wyr`, `end` | Member; `end` applies participant/Manage Messages checks. |
| `meter` | `iq` | Member. |
| `blunt` | `spark`, `smoke`, `taps` | Member. |
| `vape` | `hit`, `steal`, `flavor`, `hits` | Member. |
| `roast` | optional member | Member; playful fixed corpus, no slurs or protected-character attacks. |
| `randomhex` | none | Member. |

The root itself never has a Discord default permission that hides member
paths. Restricted handlers perform both the real Discord permission check and
`checkUserPermissions` against the complete slash path. All output suppresses
mentions unless the response intentionally identifies the selected member.

## Persistence and lifecycle

Only state that must survive restart is stored in SQLite:

- global snipe protection by user ID;
- roleplay per-guild action toggles and per-pair action counters;
- per-user blunt counters/cooldown state; and
- one vape holder, flavor, and hit count per guild.

Transient snipe entries and active games remain bounded in memory. A single
service-owned interval physically evicts expired snipe payloads every minute;
game timers enforce the published session deadlines. New tables use existing
migrations, parameterized statements, guild scoping where applicable, and guild-delete
cleanup. No new dependency, worker, external scheduler, cache, secret,
premium gate, or external database is introduced.

## Verification contract

After this contract is committed and pushed, focused mocked tests may begin.
They must cover generated slash JSON, aliases, path-aware RBAC, snipe bounds,
TTL/protection/clear behavior, partial and bot exclusions, all event hooks,
provider timeout and response/URL validation, attribution, all 43 roleplay
terminal mappings, counters/toggles, game ownership/expiry, and persistent
blunt/vape transitions. Final verification requires the complete Jest suite,
syntax checks for changed production JavaScript, migration/schema checks,
`git diff --check`, dependency audit, thread-aware PR review inspection, and a
security diff review. Live Discord behavior remains a separate deployment
proof and is not inferred from mocked tests.
