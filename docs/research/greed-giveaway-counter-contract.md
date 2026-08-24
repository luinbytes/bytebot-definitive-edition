# Greed giveaway and counter compatibility contract

Issue: [#46](https://github.com/luinbytes/bytebot-definitive-edition/issues/46)  
Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)  
Research frozen: 2026-08-24

This is the implementation gate for ByteBot giveaways and the remaining server-counter delta. It records every behavior evidenced by Greed's current public documentation and command catalog, the older public guide, and the official English localization registry pinned by the parity program. No live Greed bot was queried.

## Sources and conflicts

| Source | Evidence used | Resolution |
| --- | --- | --- |
| [Current giveaway guide](https://greed.best/docs/miscellaneous/giveaway) | Start with duration, winner count, prize, and optional role; button entry; end; reroll; blacklist; role entry limits; edits to prize, winners, duration, and description; cryptographically secure selection; creator/winner DMs. | Current behavior wins where older prose conflicts. |
| [Current command catalog](https://greed.best/commands) and its [public Discord registration mirror](https://top.gg/bot/1149535834756874250/commands) | Adds `preset save/list/delete` and `variables`; confirms current slash paths and descriptions. | These current commands are included even though the guide omits them. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/server/giveaway) | `blacklist`, `dmcreator`, `dmwinners`, `end`, `reroll`, `setmax`, `start`, `template`; edit prize/duration/winners/description/image/thumbnail/minlevel/maxlevel; 1-50 winners, 10 seconds to 30 days, 1-100 role entries, levels 0-1000, button errors, and DM wording. | Pinned paths absent from the current catalog remain evidenced and are included. |
| [Older giveaway guide](https://docs.greed.best/miscs/giveaway) | Weighted entries, automatic validation, templates, role requirements, notifications, and cleanup after five days; it also says giveaways cannot be edited. | Weighted entries remain. The no-edit statement loses to both the current guide and pinned registry. ByteBot retains compact audit history instead of deleting it after five days because issue #46 requires auditable selection. |
| [Current premium page](https://greed.best/premium) and [premium guide](https://greed.best/docs/premium) | User Premium advertises double giveaway-entry weight; Server Premium names unspecified “giveaway extras.” | ByteBot has no billing or entitlement gate. Role-based weights up to the public maximum of 100 are available to every server. Unspecified extras are an evidence gap and are not invented. |
| [Current counting guide](https://greed.best/docs/miscellaneous/counting) | `counter add (metric) [kind]`, `options`, and removal; channel kinds voice, text, category, announcement, and stage; names `members`, `bots`, and `online` as example metrics. | This is the metric-counter contract requested by #46. |
| [Pinned counter registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/counter) and [older counter guide](https://docs.greed.best/miscs/counter) | `counter enable/disable` is instead a sequential counting game. | Already delivered by #42 alongside metric aliases. This slice extends, rather than replaces, that implementation. |

The current giveaway guide describes `blacklist` once as accepting a user, while the current slash catalog and pinned English registry both identify a role. ByteBot uses a role. The current counting guide says “etc.” without enumerating the remaining metric names. ByteBot supports the four names actually evidenced across the contract (`members`, `bots`, `online`, and the already-delivered `voice`) and does not guess hidden options.

## Slash-command surface

`/giveaway` is an Administration command. Configuration and lifecycle operations require **Manage Server** by default and still pass through ByteBot's path-aware RBAC. Entering through a button is public and performs eligibility checks at click time.

| Path | ByteBot options and behavior |
| --- | --- |
| `/giveaway start` | Required `duration` (10 seconds-30 days), `winners` (1-50), and `prize`; optional required role, description, preset, image, and thumbnail. Publishes in the current text or announcement channel. |
| `/giveaway end` | End an active giveaway early by message ID. Safe retries reuse the persisted result. |
| `/giveaway reroll` | Select a new winner round for an ended giveaway. Previously selected members are excluded while unused eligible entrants remain. |
| `/giveaway blacklist` | Toggle a role's ability to enter giveaways in the server. |
| `/giveaway setmax` | Set a role's maximum weighted entries from 1-100. A member receives the highest configured maximum among their current roles; the default is one. |
| `/giveaway dmcreator`, `/giveaway dmwinners` | Set the guild's explicit notification booleans. DM failure is recorded but does not roll back a completed result. |
| `/giveaway template` | Set or clear the guild's default rich-message script. Interactive entry controls remain ByteBot-owned. |
| `/giveaway variables` | List the supported giveaway template variables. |
| `/giveaway preset save`, `list`, `delete` | Manage named guild-scoped giveaway scripts. `start preset:` selects one; deleting a preset never changes an existing giveaway snapshot. |
| `/giveaway edit prize`, `duration`, `winners`, `description`, `image`, `thumbnail`, `minlevel`, `maxlevel` | Update an active giveaway by message ID and refresh its owned message. Optional values clear description/media/level bounds where Discord permits omission. |

The template context exposes `{giveaway.prize}`, `{giveaway.ends_at}`, `{giveaway.role}`, `{giveaway.winners}`, `{giveaway.description}`, `{giveaway.entries}`, and `{giveaway.host}`. The four concepts named by the older guide are preserved; the additional values describe state ByteBot already owns. Scripts may contain content and embeds but not their own interactive components, because the entry/view controls must remain authoritative.

`/counter` remains in Utility with its existing `enable`, `disable`, `add`, `options`, `list`, `update`, and `remove` paths. `add` and `update` expose `members`, `bots`, `online`, and `voice`; all five documented channel kinds remain available. Metric updates continue through the existing leased scheduler and set the same name again safely. Newly created metric channels are marked as ByteBot-owned. Removal deletes only a marked owned metric channel; sequential counters and pre-existing/unmarked channels are never deleted.

## Eligibility, weighting, and winner audit

- Bots cannot enter. The entry handler rechecks the exact guild, message, active state, required role, blacklisted roles, and current level before changing an entry.
- Each successful click adds one entry until the highest current role maximum is reached. Role weighting is available without premium state or purchase code.
- Minimum and maximum level are optional and inclusive. Members without a ByteBot level record are level 0. The canonical level row introduced here is intentionally the same row the later levels slice will update; no parallel activity-derived approximation is used.
- Ending re-fetches guild members and revalidates every entrant. The persisted winner round records the eligible weighted candidate snapshot, exclusions, cryptographic draw order, selected user IDs, actor, and timestamp.
- Winner selection uses Node's `crypto.randomInt` and samples unique members without replacement; weight affects selection probability but never allows the same member to fill two winner slots.
- The active-to-ending claim and first winner round are one immediate SQLite transaction. A restart resumes `ending` rows from the stored round, so a deadline or repeated command cannot create a second first award.
- Rerolls create numbered immutable rounds. Previously selected users are excluded until the remaining eligible pool is exhausted. No-entry and undersubscribed outcomes are explicit rather than fabricated.

## Discord permissions and lifecycle

Starting and editing require the bot to have **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in the target channel. Message IDs are resolved only inside the current guild and must match the persisted channel/message pair. Allowed mentions default to none; winner announcements permit only the selected user IDs.

The service polls a bounded due set, prevents overlapping local runs, and reconciles active/ending giveaways on startup. Missing owned messages become `lost`; ByteBot never substitutes another message with a matching prize or timestamp. Ended giveaways, rounds, and action history remain for audit. Guild removal purges that guild's database rows. Shutdown releases the timer.

## Verification contract

The slice must leave runnable checks for:

- generated slash JSON, Discord nesting/option limits, help discovery, and Manage Server defaults;
- migration/schema integrity and guild-scoped uniqueness;
- duration/URL/script validation and source maxima;
- role blacklist, required role, weight cap, level bounds, bot exclusion, and concurrent entry updates;
- cryptographic unique weighted selection with an injectable deterministic test draw;
- active-to-ending idempotency, restart resumption, reroll history, missing messages, and no double first award;
- message rendering/editing, mention suppression, creator/winner DM settings, and failure recording;
- the existing counter scheduler with the added metrics and ownership-safe removal.

No real Discord token, live Greed command, production guild, or repository Discord test suite is used to infer behavior. Runtime deployment remains separate evidence.
