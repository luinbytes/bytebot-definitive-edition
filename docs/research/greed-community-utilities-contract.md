# Greed community utilities compatibility contract

Issue: [#53](https://github.com/luinbytes/bytebot-definitive-edition/issues/53)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for confessions, polls, thread controls, pins, solved state, image-only channels, quote, random choice, and random-member lookup. It records the complete behavior evidenced by Greed's public documentation and the official English localization registry pinned by the parity program. No live Greed bot was queried.

## Sources and conflicts

| Source | Evidence used | Resolution |
| --- | --- | --- |
| [Pinned confessions registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/confessions) | Setup/removal, public anonymous submission, replies, reaction emojis, case-insensitive contained-text blacklist, author mute/unmute, reports, sequential numbers, link rejection, and a 60-second cooldown. | Every named capability is included. Private author attribution is retained for moderation but never placed in public output. |
| [Current confessions guide](https://greed.best/docs/configuration/confessions) and [older guide](https://docs.greed.best/miscs/confessions) | Submission panels, optional category routing, required bot permissions, and the same moderation controls. The current guide shows a prefix invocation while setup strings and the older guide describe `/confess`. | ByteBot uses `/confess`; the panel button opens the same modal. Categories are capped at Discord's 25-choice component limit. |
| [Pinned poll registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun) | Multiple-option `poll`, question-only `quickpoll`, timed and quick `polls`, results, duration units `s/m/h/d`, minimum 10 seconds, and maximum 7 days. | `/fun poll create` covers timed multiple-option polls and `/fun poll quick` covers question-only polls. Public evidence is silent on duplicate voting, so #53's acceptance criterion makes one durable vote per member and rejects a repeat. |
| [Pinned thread registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/thread) and [official thread guide](https://docs.greed.best/miscs/thread) | Add/remove member, rename, slowmode, lock/unlock, archive/unarchive, delete, current or specified thread, audit reason, and caller/bot Manage Threads. | `/thread ...` exposes every action. A target is optional and defaults to the current thread. Delete requires an explicit confirmation because it is permanent. The standalone path also keeps the cumulative `/server` hub within Discord's 25-option limit. |
| [Pinned utility registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility) | Same-guild pin/unpin with pinned-state validation; image-only channel toggle; random user; and `solved`, which closes and locks a thread only in Greed's support guild. | ByteBot uses current Discord `PinMessages` and `ManageThreads` permissions. Solved is generalized to any guild forum/thread because the Greed guild restriction is deployment-specific. Image-only means at least one Discord attachment; embeds, stickers, and links alone do not qualify. |
| [Pinned fun registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun) | `choose`/`pick` select from supplied options; `quote` requires a replied message with text and returns a generated image. | `/fun choose` accepts a comma-separated list with at least two nonempty choices. `/fun quote` accepts a same-guild message link or ID and renders its text, display name, and avatar without allowing mentions. `/fun random-member` excludes bots and returns a current guild member. |
| [Current premium guide](https://greed.best/docs/premium) | No #53 capability or cap is identified as premium. | Every capability is available without billing or entitlement state. Unspecified premium behavior is not invented. |
| [Discord channel resource](https://docs.discord.com/developers/resources/channel), [message resource](https://docs.discord.com/developers/resources/message), [component reference](https://docs.discord.com/developers/components/reference), and [poll resource](https://docs.discord.com/developers/resources/poll) | Thread bounds and permissions, `PinMessages`, component custom-ID limits, and native poll bounds. Native Discord polls use hour-granularity durations and apps cannot cast votes. | ByteBot uses persisted buttons so Greed's 10-second duration and duplicate-vote rejection are enforceable. Native limits of 10 answers, 300 question characters, and 55 answer characters are retained. |

The public sources do not specify poll creator permissions, vote visibility, category grammar, image-only exemptions, random-member bot inclusion, or confession data retention. The decisions below are ByteBot-owned and are not represented as observed Greed behavior.

## Slash-command surface

The established hubs remain the discoverable categories. This avoids duplicate command implementations and preserves `/community` as the existing read-only navigation surface.

| Path | Display and behavior |
| --- | --- |
| `/confess [category]` | Public Utility command. Opens the anonymous submission modal. A configured panel button opens the same flow. |
| `/server confessions setup` | Administration; configure the destination channel and publish or refresh the submission panel. Requires Manage Server. |
| `/server confessions remove` | Disable submissions and remove configuration after explicit confirmation. Existing moderation records remain. Requires Manage Server. |
| `/server confessions category` | Add, remove, or list a category-to-channel route, capped at 24 plus the default General route to fit Discord's 25-choice limit. Requires Manage Server. |
| `/server confessions blacklist` | Add, remove, list, or clear case-insensitive blocked phrases. Requires Manage Server. |
| `/server confessions emojis` | Set, reset, or view up/down reaction emoji. Setting both to `none` disables reactions. Requires Manage Server. |
| `/server confessions mute`, `unmute`, `report` | Resolve an author by confession number without public disclosure. `unmute all` clears all author mutes. Reports reveal the author only in an ephemeral moderator response and record the supplied reason. Requires Manage Messages in the target confession channel; `unmute all` requires it in every configured confession channel. |
| `/fun poll create` | Required question, comma-separated options, and duration; publishes a 2-10 option, 10-second to 7-day single-choice poll. |
| `/fun poll quick` | Required question; publishes a yes/no poll with no scheduled result. |
| `/fun poll end` | Creator or a member with Manage Messages ends an active poll by message ID and publishes durable results. |
| `/thread add`, `remove`, `rename`, `slowmode`, `lock`, `unlock`, `archive`, `unarchive`, `delete`, `solved` | Administration actions with an optional thread target and optional audit reason. Slowmode is 0-21,600 seconds. All enforce the caller's and bot's real Manage Threads permission; add/remove also preserve Discord's native membership checks. |
| `/server community pin`, `unpin` | Pin or unpin a same-guild message link/ID. Caller and bot require the real Pin Messages permission. |
| `/server community image-only` | Enable, disable, or view attachment-only enforcement for a channel. Caller requires Manage Channels; setup verifies the bot can Manage Messages in that channel. |
| `/fun choose`, `/fun random-member`, `/fun quote` | Public Fun utilities for random selection, a non-bot guild member, and a same-guild text-message quote image. |

Every administrative path continues through ByteBot's path-aware RBAC after native Discord permissions. A virtual permission or configured role can restrict a real permission holder but can never grant Discord authority.

## Confession privacy and moderation

- Each guild has an atomic next number. A submission reserves one number, publishes in the configured route, and records the Discord message plus author ID. A failed publish rolls the reservation back without exposing identity.
- Submission rejects empty text, URLs, configured blacklist substrings, muted authors, stale panels, inaccessible destinations, and a second submission within 60 seconds. Text and stored moderator reasons use bounded lengths and suppress mentions.
- Public confession messages contain the number, text, optional category, configured reactions, and anonymous-reply/report controls; they never contain the author ID, username, avatar, or mention.
- Anonymous replies are delivered privately to the original author and retained with the replier ID for moderator accountability. Muted members cannot submit either confessions or replies. DM failure is reported to the replier without publishing either identity.
- Mute-by-number resolves the author internally. Report-by-number reveals that author only to the authorized moderator and adds an auditable moderation record. Normal list/view responses expose counts and configuration, not identities.
- Removing configuration disables future submission and invalidates its panel. Existing author mappings remain while the guild is installed so later abuse reports remain attributable; guild removal purges them.

## Poll state and components

- Poll rows snapshot guild, channel, message, creator, question, options, deadline, and active/ended status. Votes have a database uniqueness constraint on poll plus user.
- A component click must match the stored guild, channel, message, poll, and option; the poll must still be active; the voter must be a current non-bot guild member. Forged, stale, duplicate, cross-message, and cross-guild clicks are rejected ephemerally.
- A successful vote is inserted atomically and only then acknowledged. Vote totals are public; voter IDs are not displayed. A duplicate does not change the original vote.
- Timed polls use a bounded scheduler and reconcile overdue active rows on startup. Ending claims the row atomically, disables the owned buttons, and publishes deterministic counts and ties. Repeated deadlines or `/fun poll end` calls reuse the ended result.
- Quick polls remain active until manually ended. Poll state is removed with the guild; no collector-only or process-memory vote is authoritative.

## Discord actions and message enforcement

- Thread targets must be threads in the invoking guild. Names are 1-100 characters and slowmode uses Discord's 0-21,600 second bound. Delete requires `confirm:true`; solved locks and archives the thread.
- Pin/unpin accepts a Discord message URL or an ID in the current channel, rejects another guild, and rejects already-pinned/not-pinned state before calling Discord.
- Image-only enforcement runs after security/AutoMod and before UwU Lock and ordinary automation. It ignores bots, webhooks, system messages, and members with Manage Messages; every other message in an enabled exact channel must contain at least one attachment or is deleted. Failure is logged without replaying content.
- Quote input must resolve to a same-guild message with text. The generated image is bounded for Discord upload, escapes user text, fetches only Discord-hosted avatar data with a timeout, and falls back to a neutral avatar. No message mentions are parsed.
- Random selection uses Node's `crypto.randomInt`, not `Math.random`. Empty choices and guilds with no eligible non-bot member fail visibly.

## Verification contract

The slice must leave runnable checks for:

- generated slash JSON, hub nesting/option limits, help discovery, and path-aware native-plus-virtual permission behavior;
- schema/migration integrity, guild-scoped numbering/configuration, rollback, blacklist/mute/cooldown/category routing, public anonymity, moderator attribution, and reply privacy;
- poll bounds, vote uniqueness, component message/guild binding, unauthorized/stale/duplicate rejection, atomic ending, restart reconciliation, and deterministic results;
- all thread operations and bounds, deletion confirmation, solved state, same-guild message resolution, and real caller/bot permissions;
- image-only event ordering/exemptions, pin state validation, secure choice/member selection, quote escaping/avatar fallback, mention suppression, and output bounds;
- guild removal and scheduler shutdown cleanup.

No real Discord token, live Greed command, production guild, or repository Discord integration suite is used to infer behavior. Runtime deployment remains separate evidence.
